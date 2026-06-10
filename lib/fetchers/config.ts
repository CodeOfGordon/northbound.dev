/**
 * Region + source registries for the scrape pipeline. Adding a city or a company
 * source is a one-line change here; the fetchers read everything from this file.
 */

/** Per-source cap on fetched items (Apify actors are pay-per-result — keep modest). */
export const MAX_ITEMS = Math.max(1, parseInt(process.env.SCRAPE_MAX_ITEMS ?? '50', 10));

/**
 * Luma city discovery slugs (lu.ma/<slug>). Resolved at runtime via api.lu.ma/url —
 * a slug that stops resolving is skipped with a warning, not a failure.
 * (quebec-city has no Luma discovery page as of 2026-06; Eventbrite/Meetup cover it.)
 */
export const LUMA_CITY_SLUGS = ['toronto', 'montreal', 'ottawa'];

/** Eventbrite search-mode city slugs — one actor run per city. */
export const EVENTBRITE_CITIES = [
    'canada--toronto',
    'canada--mississauga',
    'canada--ottawa',
    'canada--montreal',
];
export const EVENTBRITE_CATEGORY = 'science-and-tech';

/**
 * Meetup event-search URLs — all fed to a single actor run (it charges per start).
 * The actor crawls URLs sequentially at ~1 min each and the refresh route has a
 * 300 s ceiling in production — keep this list to ~4 URLs. 'tech' is the broadest
 * umbrella search; the relevance gate + tag derivation handle classification.
 */
const MEETUP_LOCATIONS = ['ca--on--Toronto', 'ca--on--Ottawa', 'ca--qc--Montréal', 'ca--qc--Québec'];
const MEETUP_KEYWORDS = ['tech'];
export const MEETUP_SEARCH_URLS = MEETUP_LOCATIONS.flatMap((location) =>
    MEETUP_KEYWORDS.map(
        (keywords) =>
            `https://www.meetup.com/find/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&source=EVENTS`,
    ),
);

/** MLH season pages — a missing season (404) is skipped silently. */
export const MLH_SEASON_URLS = [
    'https://mlh.io/seasons/2026/events',
    'https://mlh.io/seasons/2027/events',
];
/** Keep MLH hackathons in these provinces (plus all digital ones). */
export const MLH_PROVINCES = new Set(['ON', 'Ontario', 'QC', 'Quebec', 'Québec']);

/**
 * Company sources — provider-agnostic: a company is pure config, mapped to one of
 * the generic provider adapters in company.ts. Current providers:
 *  - 'luma'  — any company Luma calendar (slug or direct calendar_api_id)
 *  - 'tribe' — any WordPress site running "The Events Calendar" (wp-json/tribe/events/v1)
 * Adding a company on a supported provider is one line here; a new events platform
 * means one new adapter, reusable by every company on it. Companies without a stable
 * feed (GDG/Bevy — robots.txt disallows their API; Microsoft Reactor — JS-only SPA;
 * Shopify/banks — no public dev-events feed) intentionally ride the city feeds above.
 */
export type CompanySource =
    | { provider: 'luma'; company: string; slug?: string; calendarApiId?: string }
    | { provider: 'tribe'; company: string; base: string; city: string };

export const COMPANY_SOURCES: CompanySource[] = [
    { provider: 'luma', company: 'Cohere', calendarApiId: 'cal-400NOkbFqzrkJNA' },
    { provider: 'luma', company: 'Notion Toronto', slug: 'notiontoronto' },
    { provider: 'tribe', company: 'Vector Institute', base: 'https://vectorinstitute.ai', city: 'Toronto' },
];
