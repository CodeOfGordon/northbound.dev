/**
 * Databricks events via the Gatsby page-data JSON behind databricks.com/events
 * (~2.25 MB, Drupal-backed; full past+future list, no pagination). Must be
 * fetched with Node's native fetch — Cloudflare blocks curl's TLS fingerprint.
 * The time-of-day in fieldDateTimeTimezone is a CMS save artifact (start ==
 * end to the second on most items), so dates are treated as date-only.
 */
import { MAX_ITEMS } from '../config';
import { stripHtml } from '../util';
import { BROWSER_UA, CompanyStdEvent, todayISO } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE_DATA = 'https://www.databricks.com/en-website-assets/page-data/events/page-data.json';

const ONLINE_TYPES = new Set(['Virtual Event', 'Webinar']);

function mapCategory(type: string | undefined): CompanyStdEvent['category'] {
    if (type === 'User Group Meetup') return 'meetup';
    if (type === 'Webinar' || type === 'Virtual Event') return 'conference';
    return undefined;
}

export async function fetchDatabricks(src: { company: string }): Promise<CompanyStdEvent[]> {
    const res = await fetch(PAGE_DATA, {
        headers: { accept: 'application/json', 'user-agent': BROWSER_UA },
    });
    if (!res.ok) throw new Error(`GET ${PAGE_DATA} → ${res.status}`);
    const data: any = await res.json();

    const events = data?.result?.pageContext?.globalContext?.eventsData?.eventsEN;
    if (!Array.isArray(events)) throw new Error('databricks: eventsEN missing from page-data');

    const today = todayISO();
    const out: CompanyStdEvent[] = [];
    for (const ev of events) {
        // One known item ships null fieldDateTimeTimezone — skip it and friends.
        const start = ev?.fieldDateTimeTimezone?.startDate;
        const path = ev?.entityUrl?.path;
        if (!ev?.title || typeof start !== 'string' || typeof path !== 'string') continue;

        // eventsEN still carries localized items (Korean/Japanese webinars, /kr/...
        // paths) — this is an English-language feed, so drop CJK titles.
        if (/[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힯]/.test(ev.title)) continue;

        const date = start.slice(0, 10);
        const endRaw = ev.fieldDateTimeTimezone.endDate;
        const endDate = typeof endRaw === 'string' ? endRaw.slice(0, 10) : date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
        if (endDate < today) continue;

        const type = ev.fieldEventType?.entity?.name;
        const city = typeof ev.fieldCity === 'string' && ev.fieldCity ? ev.fieldCity : undefined;
        const online = ONLINE_TYPES.has(type) || !city;
        const image = ev.fieldThumbnail?.entity?.fieldMediaImage?.url;
        // fieldEventRegions: [{ entity: { name: 'Europe' | 'North America' | ... } }].
        const regions: string[] = Array.isArray(ev.fieldEventRegions)
            ? ev.fieldEventRegions
                  .map((r: any) => r?.entity?.name)
                  .filter((n: any): n is string => typeof n === 'string' && n.length > 0)
            : [];

        out.push({
            _std: true,
            _provider: 'databricks',
            _company: src.company,
            id: String(ev.uuid ?? ev.nid),
            title: ev.title,
            url: `https://www.databricks.com${path}`,
            description: ev.body?.value ? stripHtml(ev.body.value) : undefined,
            image: typeof image === 'string' ? image : undefined,
            city: city ?? (online ? 'Online' : undefined),
            country: ev.fieldCountry ?? undefined,
            online,
            date,
            endDate,
            category: mapCategory(type),
            ...(regions.length ? { _regions: regions } : {}),
        });
    }

    // Soonest-first so the cap keeps the nearest events.
    out.sort((a, b) => (a.date! < b.date! ? -1 : 1));
    return out.slice(0, MAX_ITEMS);
}
