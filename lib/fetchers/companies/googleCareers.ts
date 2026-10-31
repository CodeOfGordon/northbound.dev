/**
 * Google Careers OnAir: careersonair.withgoogle.com runs on Google's "Gather"
 * events platform (same stack as Cloud OnAir). Its public JSON listing is
 * GET /api/events?state=FUTURE|LIVE|PAST&page=N →
 * { events: [...], total_events, total_pages, current_page }. Each event carries
 * name, url_slug, UTC-ISO start/end, an IANA timezone, an HTML description and
 * digital/physical flags; its page lives at /events/{url_slug}. Registration
 * needs a Google sign-in on the site, which is also how attendance is tracked.
 *
 * FUTURE is legitimately empty between campaigns and LIVE carries evergreen
 * "hub" events with years-old end dates, so we re-filter on end >= now.
 * Shape verified against PAST/LIVE responses (2026-10-31); FUTURE was empty.
 */
import { MAX_ITEMS } from '../config';
import { stripHtml } from '../util';
import { BROWSER_UA } from './shared';
import type { CompanyStdEvent } from './shared';

const BASE = 'https://careersonair.withgoogle.com';
const STATES = ['FUTURE', 'LIVE'] as const;
const MAX_PAGES = 3;

interface GatherEvent {
    id: string;
    name?: string;
    headline?: string;
    url_slug?: string;
    start?: string;
    end?: string;
    timezone?: string;
    description?: string;
    digital?: boolean;
    physical?: boolean;
    published?: boolean;
    private?: boolean;
    unlisted?: boolean;
    is_test_event?: boolean;
    languages?: { display: string; default?: boolean }[];
}

interface GatherPage {
    events?: GatherEvent[];
    total_pages?: number;
}

async function fetchPage(state: string, page: number): Promise<GatherPage> {
    const url = `${BASE}/api/events?state=${state}&page=${page}`;
    const res = await fetch(url, {
        headers: { 'user-agent': BROWSER_UA, accept: 'application/json', 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new Error(`GET ${url} → non-JSON (${type})`);
    return (await res.json()) as GatherPage;
}

/** Public, English, online-only sessions that haven't finished yet. */
function isUsable(ev: GatherEvent, nowMs: number): boolean {
    if (!ev.id || !ev.url_slug || !ev.start || !(ev.name || ev.headline)) return false;
    if (ev.published === false || ev.private || ev.unlisted || ev.is_test_event) return false;
    // In-person/hybrid sessions are tied to an overseas office; the audience here is online.
    if (ev.physical) return false;
    const english = ev.languages?.find((l) => l.default)?.display ?? 'English';
    if (english !== 'English') return false;
    const endMs = Date.parse(ev.end ?? ev.start);
    return Number.isFinite(endMs) && endMs >= nowMs;
}

export async function fetchGoogleCareers(src: { company: string }): Promise<CompanyStdEvent[]> {
    const nowMs = Date.now();
    const seen = new Map<string, GatherEvent>();

    for (const state of STATES) {
        for (let page = 0; page < MAX_PAGES; page++) {
            const body = await fetchPage(state, page);
            for (const ev of body.events ?? []) if (isUsable(ev, nowMs)) seen.set(ev.id, ev);
            if (page + 1 >= (body.total_pages ?? 0)) break;
        }
    }

    return [...seen.values()]
        .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
        .slice(0, MAX_ITEMS)
        .map((ev) => ({
            _std: true as const,
            _provider: 'google-careers',
            _company: src.company,
            id: ev.id,
            title: stripHtml(ev.name || ev.headline || ''),
            url: `${BASE}/events/${ev.url_slug}`,
            description: ev.description ? stripHtml(ev.description) : undefined,
            city: 'Online',
            online: true,
            startISO: ev.start,
            endISO: ev.end,
            timezone: ev.timezone || 'America/Los_Angeles',
            isFree: true,
        }));
}
