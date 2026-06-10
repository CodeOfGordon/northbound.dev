---
name: event-scraping
description: Use when writing or modifying the scraper that discovers and extracts raw event data from Luma, Eventbrite, Meetup, or company sites. Covers choosing Apify actors vs Playwright vs fetch vs Brave Search, polling, pagination, rate limits, and robots/ToS etiquette.
---

# Event Scraping (scraper-agent)

You discover and extract **RAW** event data. You output **raw JSON** and hand it to the
normalizer. You do **NOT** write the canonical `Event` document, compute fingerprints, or
touch MongoDB. The normalizer owns `database/event.model.ts`, dedup, and `Event.bulkWrite`.

> Region focus: **Greater Toronto Area**. Stack is MongoDB + Mongoose (NOT Supabase/Postgres —
> AGENTS.md still names Supabase in its old role table; ignore that, PROJECT CANON wins).

## Raw output contract

Emit an array of loosely-typed objects. Carry through whatever the source gives; never drop
`url`/`sourceId`. The normalizer maps these onto the canonical `Event` fields
(`title`, `slug`, `description`, `overview`, `image`, `venue`, `country`, `city`, `date`
[`YYYY-MM-DD`], `time` [`HH:MM` 24h], `mode` [`online|offline|hybrid`], `audience`,
`agenda[]`, `organizer`, `tags[]`) plus the aggregator extensions
(`url`, `source`, `sourceId`, `fingerprint`, `timezone`, `endDate`, `endTime`,
`isFree`/`price`, `category`/`eventType`).

```ts
// types you produce — keep it RAW, do not normalize here
export type RawEvent = {
  source: 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';
  sourceId?: string;          // platform id / slug
  url: string;                // REQUIRED — canonical event page link
  title: string;
  description?: string;
  image?: string;
  venue?: string;
  city?: string;
  country?: string;
  startRaw?: string;          // whatever the source emits (ISO, "Jun 12", etc.)
  endRaw?: string;
  timezone?: string;          // IANA if known; else leave undefined
  isOnline?: boolean;
  isFree?: boolean;
  price?: string;
  organizer?: string;
  tags?: string[];
  raw: unknown;               // ALWAYS attach the untouched source object
};
```

Rule: do **not** parse dates, infer `mode`, or build slugs/fingerprints. Leave `startRaw`
untouched and let the normalizer produce `date`/`time`/`timezone`. The normalizer's fingerprint
is `sha256(title|date|city)`, so it only needs clean title/date/city — your job is to give it
the rawest accurate values plus `url`.

## Decision tree — which tool

```
Do you already have the exact event/listing URLs?
├─ NO  → Brave Search MCP: discover URLs first (site: queries), then re-enter below.
└─ YES → What platform / page type?
    ├─ Luma / Eventbrite / Meetup        → Apify actor (structured, paginated, anti-bot handled)
    ├─ JS-heavy company page             → Playwright MCP (renders client-side JS, clicks, scrolls)
    │   (AWS, Databricks, GDG/Bevy, RBC)
    └─ Static / server-rendered HTML     → fetch MCP (HTML→markdown, cheapest)
        (mlh.io/seasons, communitech.ca/events, hackathons.ca)
```

Default order of preference per source = **cheapest tool that returns reliable structured data**:
Apify for the big three platforms (it owns their anti-bot + pagination), fetch for static HTML,
Playwright only when JS rendering is genuinely required, Brave only to find URLs.

## GTA target sources

| Source | Page type | Tool | Notes |
|---|---|---|---|
| lu.ma/toronto | Luma calendar/city page | Apify `mhamas/luma-calendar-events-scraper` | slug is `toronto` (NOT the full URL) |
| Eventbrite (Toronto tech) | platform search | Apify `parseforge/eventbrite-scraper` | `city: 'toronto--ontario'`, `format: networking/conference` |
| Meetup (GTA groups) | platform search | Apify `easyapi/meetup-events-scraper` | pass `searchUrls` of Meetup search pages |
| mlh.io/seasons | static HTML | fetch MCP | hackathons; server-rendered |
| communitech.ca/events | static HTML | fetch MCP | Waterloo/GTA ecosystem |
| hackathons.ca | static HTML | fetch MCP | Canadian hackathons |
| aws.amazon.com/events | JS-heavy | Playwright MCP | filter to Toronto/Canada |
| databricks.com/events | JS-heavy | Playwright MCP | client-rendered list |
| GDG / community.bevy.com | JS-heavy | Playwright MCP | Bevy SPA |
| RBC / company careers-events | JS-heavy | Playwright MCP | varies; check robots first |

## Apify (Luma / Eventbrite / Meetup)

Actor id in REST URLs is tilde-separated: `mhamas~luma-calendar-events-scraper`. Auth is a
**Bearer header** from `process.env.APIFY_TOKEN` — never in the query string (it leaks to logs).

```ts
const APIFY = 'https://api.apify.com/v2';
const headers = {
  Authorization: `Bearer ${process.env.APIFY_TOKEN}`,
  'Content-Type': 'application/json',
};

// Async run + poll (robust; sync endpoint has a hard 300s limit → 408 on long crawls)
async function runActor(actorId: string, input: unknown) {
  const start = await fetch(`${APIFY}/acts/${actorId}/runs`, {
    method: 'POST', headers, body: JSON.stringify(input),
  }).then(r => r.json());

  const runId = start.data.id;
  const datasetId = start.data.defaultDatasetId;

  // long-poll up to 60s per request instead of hammering
  let status = start.data.status;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    const run = await fetch(
      `${APIFY}/actor-runs/${runId}?waitForFinish=60`, { headers },
    ).then(r => r.json());
    status = run.data.status;
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run ${runId}: ${status}`);

  return fetch(
    `${APIFY}/datasets/${datasetId}/items?format=json&clean=true`, { headers },
  ).then(r => r.json()); // → array of raw items
}
```

Inputs (always cap during dev):

```ts
// Luma — calendar slug, NOT the URL. Caps the crawl; the `text` field pulls in the
// Website Content Crawler and burns extra credits, so keep maxEvents tiny while testing.
await runActor('mhamas~luma-calendar-events-scraper', {
  slugs: ['toronto'], dateFrom: '2026-06-08', maxEvents: 5,
});

// Eventbrite — search mode (free tier caps at 100 items regardless)
await runActor('parseforge~eventbrite-scraper', {
  city: 'toronto--ontario', date: 'next-month', format: 'networking',
  online: false, maxItems: 5,
});

// Meetup — feed it Meetup search URLs
await runActor('easyapi~meetup-events-scraper', {
  searchUrls: ['https://www.meetup.com/find/?keywords=AI&location=ca--Toronto'],
  maxItems: 5,
});
```

**Free-tier budget (~$5/mo).** Eventbrite ≈ $4/1k results, Meetup ≈ $4.99/1k — one broad run can
eat the whole month. Always set a small `maxItems`/`maxEvents` (3–10) until field shapes and the
run/poll plumbing are verified, then raise. Watch spend in Console → Billing/Usage.

## Playwright MCP (JS-heavy company pages)

Use when the listing is rendered client-side (empty/partial HTML on plain fetch). Launched
headless+isolated via `.mcp.json`. Pattern: navigate → wait for the list selector → trigger
pagination/lazy-load → snapshot, then extract anchors + structured text into `RawEvent[]`.

```
1. browser_navigate  https://www.databricks.com/events
2. browser_wait_for  (text/selector that proves the list rendered)
3. paginate/lazy-load:
     - click "Next" / "Load more" until it disappears, OR
     - browser_evaluate: scroll to bottom in a loop until scrollHeight stops growing
4. browser_snapshot / browser_evaluate: pull href + title + date text per card
5. emit RawEvent[]  (url = absolute href; startRaw = the date text verbatim)
```

Be polite: a human-like pace (a short pause between page loads), don't open many tabs in
parallel against one host, and stop once you've collected the GTA-relevant window.

## fetch MCP (static pages)

For server-rendered HTML it returns HTML→markdown directly — cheapest and no browser. Good for
`mlh.io/seasons`, `communitech.ca/events`, `hackathons.ca`. If the markdown comes back empty or
JS-shell-only, escalate to Playwright. Use `start_index`/`max_length` to page through long docs.

```
fetch  url=https://mlh.io/seasons/2026/events  max_length=20000
# parse the returned markdown → RawEvent[]; keep each event's absolute href as `url`
```

## Brave Search MCP (discover URLs first)

When you lack URLs, find them, then route each into the tree above. Scope with `site:` and the
region.

```
brave_web_search  query="site:lu.ma Toronto AI OR data engineering 2026"
brave_web_search  query="Toronto tech meetup AI June 2026 site:meetup.com"
brave_web_search  query="GDG Toronto event 2026"
```

Free tier ≈ 2,000 queries/month — discover in batches, cache the URLs you find, don't re-search
the same terms every run.

## Polling, pagination, rate limits, retries

- **Polling:** prefer Apify async-run + `waitForFinish=60` long-poll over the 300s sync endpoint.
- **Pagination:** Apify → `maxItems`/`maxEvents` + dataset `limit`/`offset`; Playwright → click
  "load more"/scroll loop until stable; fetch → `start_index` over long markdown.
- **Rate limits / backoff:** on HTTP 429/5xx, retry with exponential backoff + jitter; cap retries.

```ts
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      const retriable = [429, 500, 502, 503, 504, 408].includes(e?.status);
      if (i >= tries - 1 || !retriable) throw e;
      const delay = Math.min(1000 * 2 ** i, 15000) + Math.random() * 500; // jitter
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

- **Proxy rotation:** the Apify actors handle proxies internally (set `proxyConfiguration` if the
  actor exposes it). For Playwright on flaky hosts, run isolated and slow down rather than
  hammering — don't bolt on third-party proxies unless a source actively blocks you.
- **Idempotency:** your reruns re-see the same events; that's fine — dedup is the normalizer's job
  (fingerprint upsert). Don't try to dedupe in the scraper.

## robots.txt / ToS etiquette (do this before any new source)

1. Check `https://<host>/robots.txt`; respect `Disallow` and any `Crawl-delay`.
2. Prefer official/structured access (Apify actors for Luma/Eventbrite/Meetup) over hand-scraping.
3. Identify a sane request pace; never flood a host. Cap pages to the GTA window.
4. Take only public listing data needed to build the feed — no logged-in/paywalled content, no PII.
5. Cache results and run on a schedule (nightly) rather than tight loops.
6. If a source's ToS forbids scraping, stop and log it for the normalizer/maintainer; don't bypass
   anti-bot measures.

## Secrets & env

Server-only, never `NEXT_PUBLIC_`: `APIFY_TOKEN`, `BRAVE_API_KEY`, `CRON_SECRET`. MongoDB
(`MONGODB_URI`) is the normalizer's concern, not yours. MCP servers are wired in root `.mcp.json`
(`apify`, `playwright`, `fetch`, `brave-search`, `mongodb`).

## If you trigger scraping from an API route

Scheduler hits a route that kicks off scraping. Per the bundled Next.js 16 docs
(`node_modules/next/dist/docs/01-app`) — this is a modified Next.js, treat those as truth:

```ts
// app/api/scrape/route.ts
export const runtime = 'nodejs';        // browsers/native fetch loops need Node, not Edge
export const dynamic = 'force-dynamic'; // GET handlers are NOT cached by default in v16; this is explicit

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // run scrapers → RawEvent[] → hand to the normalizer (you do NOT write Event here)
}
```
