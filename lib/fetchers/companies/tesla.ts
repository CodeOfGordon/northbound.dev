/**
 * Tesla events via the events SPA's JSON backend (/{locale}/events/api/events).
 * Geo-scoped: each query returns upcoming events within ~120 km of a lat/lng
 * centroid, so we hit the API once per configured city and dedupe on the path
 * slug. Akamai TLS-fingerprints curl into a 403 site-wide but plain Node fetch
 * with a browser UA passes (verified live 2026-06-10) — exactly our runtime.
 */
import { MAX_ITEMS } from '../config';
import { stripHtml } from '../util';
import { BROWSER_UA, todayISO, type CompanyStdEvent } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOURS_RE = /(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?/i;

const to24h = (hour: string, minute: string | undefined, meridiem: string) =>
    `${String((parseInt(hour, 10) % 12) + (meridiem.toUpperCase() === 'P' ? 12 : 0)).padStart(2, '0')}:${minute ?? '00'}`;

/** '11 AM - 5 PM' → ['11:00', '17:00']; null when absent/unparseable (never invent times). */
function parseHours(hours: unknown): [string, string] | null {
    const m = typeof hours === 'string' ? hours.match(HOURS_RE) : null;
    return m ? [to24h(m[1], m[2], m[3]), to24h(m[4], m[5], m[6])] : null;
}

/**
 * dates[].startDate/endDate are FAUX-UTC: '2026-06-21T00:00:00+00:00' encodes the
 * LOCAL calendar date at midnight, not a real instant — only the date part is
 * meaningful (real clock times live in the human 'hours' string).
 */
const localDate = (faux: unknown): string | null => {
    const d = String(faux ?? '').slice(0, 10);
    return ISO_DATE.test(d) ? d : null;
};

async function centroidEvents(locale: string, lat: number, lng: number): Promise<any[]> {
    const url = `https://www.tesla.com/${locale}/events/api/events?lat=${lat}&lng=${lng}&page=1&limit=${MAX_ITEMS}`;
    const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': BROWSER_UA },
    });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    const data: any = await res.json();
    return Array.isArray(data?.events) ? data.events : [];
}

export async function fetchTesla(src: {
    company: string;
    locale: string;
    centroids: { city: string; lat: number; lng: number }[];
}): Promise<CompanyStdEvent[]> {
    const errors: Error[] = [];
    const perCity = await Promise.all(
        src.centroids.map(async (c) => {
            try {
                return await centroidEvents(src.locale, c.lat, c.lng);
            } catch (e) {
                console.warn(`tesla: centroid "${c.city}" skipped — ${(e as Error).message}`);
                errors.push(e as Error);
                return [];
            }
        }),
    );
    if (errors.length === src.centroids.length && errors.length > 0) throw errors[0];

    const seen = new Set<string>();
    const out: CompanyStdEvent[] = [];
    for (const ev of perCity.flat()) {
        if (out.length >= MAX_ITEMS) break;
        if (!ev?.path || !ev.title || seen.has(ev.path)) continue;
        seen.add(ev.path);

        const loc = ev.locations?.[0];
        // First occurrence that hasn't ended in the venue's own zone (recurring
        // events list one dates[] entry per occurrence); none upcoming → skip.
        const today = todayISO(loc?.timezone ?? undefined);
        const occ = (Array.isArray(ev.dates) ? ev.dates : []).find(
            (d: any) => (localDate(d?.endDate) ?? localDate(d?.startDate) ?? '') >= today,
        );
        const date = occ && localDate(occ.startDate);
        if (!date) continue;

        const endDate = localDate(occ.endDate);
        const times = parseHours(occ.hours);
        const online = ev.virtualEventLink != null;
        out.push({
            _std: true,
            _provider: 'tesla',
            _company: src.company,
            id: ev.path,
            title: stripHtml(String(ev.title)),
            url: `https://www.tesla.com/${src.locale}/events/${ev.path}`,
            description: ev.summary ? stripHtml(String(ev.summary)) : undefined,
            image: ev.headerImageUrls?.regular || undefined,
            city: loc?.city ?? (online ? 'Online' : undefined),
            country: loc?.country ?? undefined,
            venue: loc?.locationName ?? undefined,
            online,
            timezone: loc?.timezone ?? undefined,
            date,
            endDate: endDate && endDate !== date ? endDate : undefined,
            time: times?.[0],
            endTime: times?.[1],
        });
    }
    return out;
}
