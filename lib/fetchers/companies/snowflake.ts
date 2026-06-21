/**
 * Snowflake developer events: /en/developers/events/ is server-rendered AEM with
 * the full hit list embedded in <script id="__INITIAL_STATE__"> — walk the state
 * tree for the location-based-event-search component and read initialHits.hits.
 * (The raw filter.json API returns identical hits but is robots-disallowed.)
 * Cards are third-party conferences Snowflake attends: date-only start, free-text
 * city, external registration url; no end date, venue, times or description.
 */
import { MAX_ITEMS } from '../config';
import { BROWSER_UA, monthNumber, todayISO } from './shared';
import type { CompanyStdEvent } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE = 'https://www.snowflake.com/en/developers/events/';
const SEARCH_TYPE = 'snowflake-site/components/location-based-event-search';

/** Depth-first walk of the AEM state tree for the node with the given ':type'. */
function findByType(node: any, type: string): any {
    if (!node || typeof node !== 'object') return null;
    if (node[':type'] === type) return node;
    for (const value of Object.values(node)) {
        const found = findByType(value, type);
        if (found) return found;
    }
    return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * eventDate is 'DD MON' with no year, but the feed is upcoming-only, so resolve
 * to the next occurrence of that day+month on/after today (inferYearDate's
 * ~6-month look-back would mis-anchor here — e.g. a March card fetched in
 * December must mean next year, not last spring).
 */
function nextOccurrence(raw: string, today: string): string | null {
    const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]+)$/);
    if (!m) return null;
    const month = monthNumber(m[2]);
    if (!month) return null;
    const monthDay = `${pad(month)}-${pad(parseInt(m[1], 10))}`;
    const year = parseInt(today.slice(0, 4), 10);
    const candidate = `${year}-${monthDay}`;
    return candidate < today ? `${year + 1}-${monthDay}` : candidate;
}

export async function fetchSnowflake(src: { company: string }): Promise<CompanyStdEvent[]> {
    const res = await fetch(PAGE, { headers: { 'user-agent': BROWSER_UA } });
    if (!res.ok) throw new Error(`GET ${PAGE} → ${res.status}`);
    const html = await res.text();

    const state = html.match(/<script[^>]*id="__INITIAL_STATE__"[^>]*>([\s\S]*?)<\/script>/);
    if (!state) throw new Error('__INITIAL_STATE__ script not found');
    const search = findByType(JSON.parse(state[1]), SEARCH_TYPE);
    const hits = search?.initialHits?.hits;
    if (!Array.isArray(hits)) throw new Error('event-search hits not found in __INITIAL_STATE__');

    const today = todayISO();
    const events: CompanyStdEvent[] = [];
    for (const hit of hits) {
        const title = hit?.title?.lines?.[0];
        const rawUrl = hit?.button?.buttonLink?.url;
        const date = nextOccurrence(String(hit?.eventDate ?? ''), today);
        if (typeof title !== 'string' || typeof rawUrl !== 'string' || !date || date < today) continue;
        // Fragment paths end '/<slug>/jcr:content/data/master' — keep the slug.
        const slug = String(hit.path ?? '').split('/jcr:content')[0].split('/').filter(Boolean).pop();
        events.push({
            _std: true,
            _provider: 'snowflake',
            _company: src.company,
            id: slug || undefined,
            title: title.trim(),
            url: rawUrl.startsWith('/') ? `https://www.snowflake.com${rawUrl}` : rawUrl,
            image: hit.image?.src || undefined,
            city: hit.eventLocation ? String(hit.eventLocation).trim() : undefined,
            online: false,
            date,
        });
    }
    return events.slice(0, MAX_ITEMS);
}
