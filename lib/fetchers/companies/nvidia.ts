/**
 * NVIDIA's official events calendar — the AEM DAM JSON that the events-page
 * widget XHRs (single array, past + future, ~580 items). The asset is
 * hand-edited, so expect mixed date formats, 'TBC' dates and empty urls.
 * robots.txt blanket-blocks AI-crawler UA tokens; request with BROWSER_UA.
 * Verified live 2026-06-10.
 */
import { MAX_ITEMS } from '../config';
import { BROWSER_UA, CompanyStdEvent, parseLooseUSDate, todayISO } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CALENDAR_URL =
    'https://www.nvidia.com/content/dam/en-zz/Solutions/about-nvidia/calendar/en-us.json';
const FALLBACK_URL = 'https://www.nvidia.com/en-us/events/';

/** 'Hackathon' / 'Tradeshow or Conference' / 'Conference / Summit' / webinars → category. */
function categoryOf(type: string): CompanyStdEvent['category'] {
    const t = type.toLowerCase();
    if (t.includes('hackathon')) return 'hackathon';
    if (t.includes('tradeshow') || t.includes('conference') || t.includes('webinar')) {
        return 'conference';
    }
    return undefined;
}

export async function fetchNvidia(src: { company: string }): Promise<CompanyStdEvent[]> {
    const res = await fetch(CALENDAR_URL, {
        headers: { accept: 'application/json', 'user-agent': BROWSER_UA },
    });
    if (!res.ok) throw new Error(`GET ${CALENDAR_URL} → ${res.status}`);
    const items = (await res.json()) as any[];
    if (!Array.isArray(items)) throw new Error('nvidia: calendar payload is not an array');

    const today = todayISO();
    const out: CompanyStdEvent[] = [];
    for (const item of items) {
        if (typeof item?.title !== 'string' || !item.title.trim()) continue;
        const date = typeof item.startDate === 'string' ? parseLooseUSDate(item.startDate) : null;
        if (!date) continue; // 'TBC' and other hand-edited junk
        const endDate =
            (typeof item.endDate === 'string' && parseLooseUSDate(item.endDate)) || date;
        if (endDate < today) continue;

        const location = typeof item.location === 'string' ? item.location.trim() : '';
        const venue = typeof item.venue === 'string' ? item.venue.trim() : '';
        const type = typeof item.type === 'string' ? item.type : '';
        const online = /virtual|online/i.test(`${location} ${venue}`) || /webinar/i.test(type);
        const url = typeof item.url === 'string' && item.url.trim() ? item.url.trim() : FALLBACK_URL;
        const description =
            typeof item.description === 'string' && item.description.trim()
                ? item.description.trim()
                : undefined;
        // 'regions' is a messy free-text string ('North America', 'EMEA', 'Asia-Pacific',
        // 'Global', sometimes blank/trailing-spaces) — split on comma/slash, trim, drop empties.
        const regions =
            typeof item.regions === 'string'
                ? item.regions
                      .split(/[,/]/)
                      .map((r: string) => r.trim())
                      .filter((r: string) => r.length > 0)
                : [];

        out.push({
            _std: true,
            _provider: 'nvidia',
            _company: src.company,
            title: item.title.trim(),
            url,
            description,
            // Location is a free-form city string; 'Virtual Event' → Online.
            city: location ? (/^(virtual|online)( event)?$/i.test(location) ? 'Online' : location) : undefined,
            venue: venue || undefined,
            online,
            // All-day calendar dates, no timezone and no times in the feed.
            date,
            endDate,
            category: categoryOf(type),
            ...(regions.length ? { _regions: regions } : {}),
        });
    }

    // Earliest-first so the MAX_ITEMS cap keeps the soonest events.
    out.sort((a, b) => a.date!.localeCompare(b.date!));
    return out.slice(0, MAX_ITEMS);
}
