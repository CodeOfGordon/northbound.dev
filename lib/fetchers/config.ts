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
 * the provider adapters in company.ts. Generic providers (reusable across companies):
 *  - 'luma'  — any company Luma calendar (slug or direct calendar_api_id)
 *  - 'tribe' — any WordPress site running "The Events Calendar" (wp-json/tribe/events/v1)
 * Bespoke platform adapters (one per company events platform, lib/fetchers/companies/):
 * google (devsite gallery HTML), aws (directory API), reactor (Microsoft Reactor API),
 * yc (Inertia data-page), nvidia (AEM DAM calendar JSON), tesla (events API),
 * databricks (Gatsby page-data), snowflake (AEM __INITIAL_STATE__), figma (RSC payload).
 * All endpoints live-verified 2026-06-10 — see .claude/docs/gotchas.md for the traps.
 * Still excluded: GDG/Bevy + CNCF community (robots.txt disallows /api/), Apple/Meta
 * (no public feed), Shopify/banks (no dev-events feed) — those ride the city feeds.
 */
export type CompanySource =
    | { provider: 'luma'; company: string; slug?: string; calendarApiId?: string }
    | { provider: 'tribe'; company: string; base: string; city: string }
    | { provider: 'google' | 'aws' | 'reactor' | 'nvidia' | 'databricks' | 'snowflake' | 'figma'; company: string }
    | { provider: 'yc'; company: string; slugs: string[] }
    | {
          provider: 'tesla';
          company: string;
          locale: string;
          centroids: { city: string; lat: number; lng: number }[];
      };

export const COMPANY_SOURCES: CompanySource[] = [
    // Bespoke platform feeds (big tech / official dev-event hubs)
    { provider: 'google', company: 'Google' },
    { provider: 'aws', company: 'AWS' },
    { provider: 'reactor', company: 'Microsoft Reactor' },
    { provider: 'yc', company: 'Y Combinator', slugs: ['startup-school-2026'] },
    { provider: 'nvidia', company: 'NVIDIA' },
    {
        provider: 'tesla',
        company: 'Tesla',
        locale: 'en_ca',
        centroids: [
            { city: 'Toronto', lat: 43.6532, lng: -79.3832 },
            { city: 'Montreal', lat: 45.5019, lng: -73.5674 },
        ],
    },
    { provider: 'databricks', company: 'Databricks' },
    { provider: 'snowflake', company: 'Snowflake' },
    { provider: 'figma', company: 'Figma' },

    // Luma calendars (generic provider — a company here is pure config).
    // calendar_api_ids verified against the official calendars 2026-06-10; several
    // had 0 upcoming events that day — they cost one cheap request and populate
    // automatically when the company posts.
    { provider: 'luma', company: 'Cohere', calendarApiId: 'cal-400NOkbFqzrkJNA' },
    { provider: 'luma', company: 'Google DeepMind', calendarApiId: 'cal-7Q5A70Bz5Idxopu' },
    { provider: 'luma', company: 'Modal', calendarApiId: 'cal-lYa2810srHvkQRC' },
    { provider: 'luma', company: 'Cursor', calendarApiId: 'cal-iRJOAxy06J8zCJd' },
    { provider: 'luma', company: 'LangChain', calendarApiId: 'cal-mvNH1VHlaFtSMFx' },
    { provider: 'luma', company: 'Cloudflare', calendarApiId: 'cal-BM6bfUtS2kt0waC' },
    { provider: 'luma', company: 'Hugging Face', calendarApiId: 'cal-BHCbNUcyZTBdvrw' },
    { provider: 'luma', company: 'Weights & Biases', calendarApiId: 'cal-8kHjPsvCPQtYtUp' },
    { provider: 'luma', company: 'Vercel', calendarApiId: 'cal-gSh9SvoKtY7rLNY' },
    { provider: 'luma', company: 'Perplexity', calendarApiId: 'cal-twKC2Cvup5GBDvt' },
    { provider: 'luma', company: 'ElevenLabs', calendarApiId: 'cal-mPiXcxrFngw3uC3' },
    { provider: 'luma', company: 'Linear', calendarApiId: 'cal-yQRC7YwpEmCUqGF' },
    { provider: 'luma', company: 'Notion Toronto', slug: 'notiontoronto' },
    { provider: 'tribe', company: 'Vector Institute', base: 'https://vectorinstitute.ai', city: 'Toronto' },
];
