/** Careers OnAir adapter: fixture mirrors the verified /api/events shape. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGoogleCareers } from '@/lib/fetchers/companies/googleCareers';
import { normalizeRawEvent } from '@/database/normalize';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const future = new Date(Date.now() + 7 * 864e5).toISOString();
const later = new Date(Date.now() + 7 * 864e5 + 36e5).toISOString();
const base = { published: true, private: false, unlisted: false, physical: false, digital: true, timezone: 'America/Los_Angeles', languages: [{ display: 'English', default: true }] };
const events = [
    { ...base, id: 'a1', name: 'Interview Prep', url_slug: 'ptg-genswe', start: future, end: later, description: '<div>Prep &amp; practice</div>' },
    { ...base, id: 'old', name: 'Evergreen hub', url_slug: 'hub', start: '2025-03-25T02:30:00+00:00', end: '2025-07-31T09:00:00+00:00' },
    { ...base, id: 'jp', name: 'Tokyo', url_slug: 'jp', start: future, end: later, physical: true },
    { ...base, id: 'priv', name: 'Private', url_slug: 'p', start: future, end: later, private: true },
    { ...base, id: 'fr', name: 'Salut', url_slug: 'fr', start: future, end: later, languages: [{ display: 'French', default: true }] },
];

test('keeps only public, English, online, upcoming sessions and normalizes them', async () => {
    globalThis.fetch = (async (url: string) => {
        const body = String(url).includes('state=FUTURE')
            ? { events, total_events: events.length, total_pages: 1, current_page: 0 }
            : { events: [], total_events: 0, total_pages: 0, current_page: 0 };
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const raw = await fetchGoogleCareers({ company: 'Google Careers' });
    assert.deepEqual(raw.map((e) => e.id), ['a1']);
    assert.equal(raw[0].url, 'https://careersonair.withgoogle.com/events/ptg-genswe');

    const doc = normalizeRawEvent(raw[0], 'company') as any;
    assert.equal(doc.organizer, 'Google Careers');
    assert.equal(doc.mode, 'online');
    assert.equal(doc.region, 'ONLINE');
    assert.match(doc.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('empty FUTURE feed yields no events and no error', async () => {
    globalThis.fetch = (async () =>
        new Response(JSON.stringify({ events: [], total_events: 0, total_pages: 0, current_page: 0 }), {
            headers: { 'content-type': 'application/json' },
        })) as typeof fetch;
    assert.deepEqual(await fetchGoogleCareers({ company: 'Google Careers' }), []);
});
