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
 * lu.ma has no dedicated "hackathon" discover category — hackathons live inside the
 * AI and Tech categories. The hackathon fetcher pulls these global feeds and keeps
 * only hackathon-named events that are virtual or in CA/US. Category api_ids resolved
 * via api.lu.ma/url?url=ai|tech (verified 2026-06).
 */
export const LUMA_HACKATHON_CATEGORIES = ['cat-ai', 'cat-tech'];

/**
 * Real hackathons are time-boxed; Devpost/DoraHacks also list perpetual "marathon"
 * / template challenges with multi-month-to-year windows. Drop anything whose
 * start→end span exceeds this so the feed stays event-like, not evergreen.
 */
export const MAX_HACKATHON_DAYS = 120;

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
/** Industry buckets — drive the "companies we track" directory + filtering. */
export type Industry =
    | 'AI Labs'
    | 'ML & Data'
    | 'Dev Tools'
    | 'Cloud & Infra'
    | 'Big Tech'
    | 'Startups & VC'
    | 'Research';

/** Display order for the directory (most AI/dev-relevant first). */
export const INDUSTRY_ORDER: Industry[] = [
    'AI Labs',
    'ML & Data',
    'Dev Tools',
    'Cloud & Infra',
    'Big Tech',
    'Startups & VC',
    'Research',
];

/** Fields shared by every company entry, regardless of provider. */
type CompanyMeta = {
    company: string;
    industry: Industry;
    /** Consumer brands (e.g. Tesla) whose feed also carries dev events — keep only the relevant ones. */
    devOnly?: boolean;
};

export type CompanySource = CompanyMeta &
    (
        | { provider: 'luma'; slug?: string; calendarApiId?: string }
        | { provider: 'tribe'; base: string; city: string }
        | { provider: 'google' | 'aws' | 'reactor' | 'nvidia' | 'databricks' | 'snowflake' | 'figma' }
        | { provider: 'yc'; slugs: string[] }
        | { provider: 'tesla'; locale: string; centroids: { city: string; lat: number; lng: number }[] }
    );

export const COMPANY_SOURCES: CompanySource[] = [
    // Bespoke platform feeds (big tech / official dev-event hubs)
    { provider: 'google', company: 'Google', industry: 'Big Tech' },
    { provider: 'aws', company: 'AWS', industry: 'Cloud & Infra' },
    { provider: 'reactor', company: 'Microsoft Reactor', industry: 'Big Tech' },
    { provider: 'yc', company: 'Y Combinator', industry: 'Startups & VC', slugs: ['startup-school-2026'] },
    { provider: 'nvidia', company: 'NVIDIA', industry: 'ML & Data' },
    {
        provider: 'tesla',
        company: 'Tesla',
        industry: 'Big Tech',
        devOnly: true, // feed is mostly consumer/retail — keep only dev/tech events
        locale: 'en_ca',
        centroids: [
            { city: 'Toronto', lat: 43.6532, lng: -79.3832 },
            { city: 'Montreal', lat: 45.5019, lng: -73.5674 },
        ],
    },
    { provider: 'databricks', company: 'Databricks', industry: 'ML & Data' },
    { provider: 'snowflake', company: 'Snowflake', industry: 'ML & Data' },
    { provider: 'figma', company: 'Figma', industry: 'Dev Tools' },

    // Luma calendars (generic provider — a company here is pure config).
    // calendar_api_ids verified against the official calendars; several may have 0
    // upcoming events on a given day — they cost one cheap request and populate
    // automatically when the company posts.
    { provider: 'luma', company: 'Cohere', industry: 'AI Labs', calendarApiId: 'cal-400NOkbFqzrkJNA' },
    { provider: 'luma', company: 'Google DeepMind', industry: 'AI Labs', calendarApiId: 'cal-7Q5A70Bz5Idxopu' },
    { provider: 'luma', company: 'Modal', industry: 'Cloud & Infra', calendarApiId: 'cal-lYa2810srHvkQRC' },
    { provider: 'luma', company: 'Cursor', industry: 'Dev Tools', calendarApiId: 'cal-iRJOAxy06J8zCJd' },
    { provider: 'luma', company: 'LangChain', industry: 'Dev Tools', calendarApiId: 'cal-mvNH1VHlaFtSMFx' },
    { provider: 'luma', company: 'Cloudflare', industry: 'Cloud & Infra', calendarApiId: 'cal-BM6bfUtS2kt0waC' },
    { provider: 'luma', company: 'Hugging Face', industry: 'AI Labs', calendarApiId: 'cal-BHCbNUcyZTBdvrw' },
    { provider: 'luma', company: 'Weights & Biases', industry: 'ML & Data', calendarApiId: 'cal-8kHjPsvCPQtYtUp' },
    { provider: 'luma', company: 'Vercel', industry: 'Dev Tools', calendarApiId: 'cal-gSh9SvoKtY7rLNY' },
    { provider: 'luma', company: 'Perplexity', industry: 'AI Labs', calendarApiId: 'cal-twKC2Cvup5GBDvt' },
    { provider: 'luma', company: 'ElevenLabs', industry: 'AI Labs', calendarApiId: 'cal-mPiXcxrFngw3uC3' },
    { provider: 'luma', company: 'Linear', industry: 'Dev Tools', calendarApiId: 'cal-yQRC7YwpEmCUqGF' },
    { provider: 'luma', company: 'Notion Toronto', industry: 'Dev Tools', slug: 'notiontoronto' },

    // Additional active calendars (verified upcoming events 2026-06-13).
    { provider: 'luma', company: 'Fireworks AI', industry: 'AI Labs', calendarApiId: 'cal-b0bByM1vbBukIX5' },
    { provider: 'luma', company: 'Together AI', industry: 'AI Labs', calendarApiId: 'cal-Icg56OoJNDuOt3e' },
    { provider: 'luma', company: 'Runway', industry: 'AI Labs', calendarApiId: 'cal-hPh8ZoNbzhxXtAX' },
    { provider: 'luma', company: 'Pinecone', industry: 'ML & Data', calendarApiId: 'cal-2M3Hb2l8cLcIrdd' },
    { provider: 'luma', company: 'LlamaIndex', industry: 'ML & Data', calendarApiId: 'cal-ftFzB9u29zBCzLC' },
    { provider: 'luma', company: 'Comet', industry: 'ML & Data', calendarApiId: 'cal-KYVKY6E5Qt1z6PW' },
    { provider: 'luma', company: 'MotherDuck', industry: 'ML & Data', calendarApiId: 'cal-k7S7WUj7XGgcjsC' },
    { provider: 'luma', company: 'Render', industry: 'Dev Tools', calendarApiId: 'cal-WUpOAuId3YmWDse' },
    { provider: 'luma', company: 'PostHog', industry: 'Dev Tools', calendarApiId: 'cal-qJCKF7ct5XX3pwB' },
    { provider: 'luma', company: 'Resend', industry: 'Dev Tools', calendarApiId: 'cal-R5PuHGCSvEkrFvh' },
    { provider: 'luma', company: 'Inngest', industry: 'Dev Tools', calendarApiId: 'cal-8SRs6VK5CS4mgEl' },
    { provider: 'luma', company: 'Pulumi', industry: 'Dev Tools', calendarApiId: 'cal-WHLXhxFwCUYbG49' },
    { provider: 'luma', company: 'Raycast', industry: 'Dev Tools', calendarApiId: 'cal-KwZeQ0HC9LFQ3Fk' },

    // Canadian innovation hubs / ecosystem orgs (recurring AI/dev programming).
    { provider: 'luma', company: 'Communitech', industry: 'Startups & VC', calendarApiId: 'cal-xN0J6QkQRTN3jiU' },
    { provider: 'luma', company: 'MaRS Discovery District', industry: 'Startups & VC', calendarApiId: 'cal-JyxiKgDYFePUjAL' },

    { provider: 'tribe', company: 'Vector Institute', industry: 'Research', base: 'https://vectorinstitute.ai', city: 'Toronto' },
];

/** Flat directory for the UI — every tracked company + its industry, name-sorted. */
export const COMPANY_DIRECTORY: { name: string; industry: Industry }[] = COMPANY_SOURCES.map(
    (s) => ({ name: s.company, industry: s.industry }),
).sort((a, b) => a.name.localeCompare(b.name));

/** Companies whose feed is mostly consumer/retail — keep only dev-relevant events. */
export const DEV_ONLY_COMPANIES = new Set(
    COMPANY_SOURCES.filter((s) => s.devOnly).map((s) => s.company),
);
