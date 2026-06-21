/**
 * AWS events via the official directory-search JSON API that powers
 * aws.amazon.com/events/explore-aws-events/ (alias#events-webinars-interactive-cards).
 * robots.txt explicitly allows /api/dirs/items/search. The API has no server-side
 * date-range operator, so we sort desc by date (upcoming items sit contiguously at
 * the top of page 0) and keep additionalFields.date >= today client-side.
 * Verified live 2026-06-10.
 */
import { MAX_ITEMS } from '../config';
import { stripHtml } from '../util';
import { BROWSER_UA, todayISO, type CompanyStdEvent } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API =
    'https://aws.amazon.com/api/dirs/items/search' +
    '?item.directoryId=alias%23events-webinars-interactive-cards' +
    '&item.locale=en_US&sort_by=item.additionalFields.date&sort_order=desc&size=100&page=0';

/** Mirrors the official page config: archived, third-party and on-demand cards are hidden. */
const EXCLUDED_TAGS = new Set([
    'GLOBAL#local-tags-flag#archived',
    'GLOBAL#local-tags-series#third-party',
    'GLOBAL#local-tags-events-master-series#third-party',
    'GLOBAL#aws-event-type#on-demand',
]);

/** ctaLink may be site-relative or an external partner URL; reject anything else. */
function absoluteUrl(link: unknown): string | undefined {
    if (typeof link !== 'string' || !link) return undefined;
    if (link.startsWith('/')) return `https://aws.amazon.com${link}`;
    return /^https?:\/\//.test(link) ? link : undefined;
}

export async function fetchAws(src: { company: string }): Promise<CompanyStdEvent[]> {
    const res = await fetch(API, {
        headers: { accept: 'application/json', 'user-agent': BROWSER_UA },
    });
    if (!res.ok) throw new Error(`GET ${API} → ${res.status}`);
    const data: any = await res.json();

    const today = todayISO();
    const out: CompanyStdEvent[] = [];
    for (const entry of data?.items ?? []) {
        const af = entry?.item?.additionalFields;
        if (!af) continue;
        const date = typeof af.date === 'string' ? af.date.slice(0, 10) : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) continue;

        const tags: string[] = (entry.tags ?? []).map((t: any) => t?.id).filter(Boolean);
        if (tags.some((t) => EXCLUDED_TAGS.has(t))) continue;

        const title = af.title || af.heading;
        const url = absoluteUrl(af.ctaLink) ?? absoluteUrl(af.primaryCTALink);
        if (!title || !url) continue;

        const location = typeof af.location === 'string' ? af.location.trim() : '';
        const online =
            tags.includes('GLOBAL#aws-event-type#virtual') ||
            /\b(online|virtual)\b/i.test(location);
        // location is free text ('Phoenix, AZ', full street address, often null):
        // the first comma segment is the best city guess unless it looks like a
        // street number.
        const cityToken = location.split(',')[0].trim();
        const city = online ? 'Online' : cityToken && !/^\d/.test(cityToken) ? cityToken : undefined;
        // Bare local date; 'time' is rarely set (e.g. '17:00+00:00') — keep HH:MM only.
        const time = typeof af.time === 'string' ? /^(\d{2}:\d{2})/.exec(af.time)?.[1] : undefined;

        out.push({
            _std: true,
            _provider: 'aws',
            _company: src.company,
            id: entry.item.id,
            title,
            url,
            description: stripHtml(`${af.body ?? ''} ${af.bodyBack ?? ''}`) || undefined,
            image: absoluteUrl(af.mediaSrc) ?? absoluteUrl(af.mediaThumbnail),
            city,
            venue: location || undefined,
            online,
            date,
            time,
            timezone: typeof af.timeZone === 'string' && af.timeZone ? af.timeZone : undefined,
        });
    }

    // API order is farthest-date-first; flip so the cap keeps the soonest events.
    return out.reverse().slice(0, MAX_ITEMS);
}
