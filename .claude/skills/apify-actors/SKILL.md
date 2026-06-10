---
name: apify-actors
description: Use when invoking Apify actors via the Apify MCP server or REST API to scrape Luma/Eventbrite/Meetup events. Covers actor selection, running, polling runs/last, fetching dataset items, the APIFY_TOKEN, and free-tier budgeting.
---

# Apify Actors — Scraping Luma / Eventbrite / Meetup

Use Apify actors to pull raw upcoming-event JSON for the DevEvents feed (GTA tech/AI/data
events + hackathons). Raw output goes to the normalizer, which upserts into the Mongoose
`Event` model (see `database/event.model.ts`). This skill covers picking actors, running
them (MCP + REST), polling, fetching dataset items, auth, and budgeting.

> Region focus: Greater Toronto Area. Always constrain inputs to Toronto where the actor allows it.

## Token (server-only secret)

`APIFY_TOKEN` lives in the environment only — never `NEXT_PUBLIC_`, never hardcoded.
Get it from Apify Console -> Settings -> API & Integrations. The MCP server reads it from
`APIFY_TOKEN` (see the `apify` block in `.mcp.json` at repo root). In REST code read
`process.env.APIFY_TOKEN` and send it as a Bearer header (the `?token=` query param also
works but leaks into logs — do not use it).

```ts
const headers = {
  Authorization: `Bearer ${process.env.APIFY_TOKEN}`,
  'Content-Type': 'application/json',
};
```

## Path A — Apify MCP server (interactive, preferred for exploration)

`.mcp.json` already starts it: `npx -y @apify/actors-mcp-server --tools actors,docs`
(env `APIFY_TOKEN`). With `--tools actors,docs` you get generic tools to search for, add,
and call actors plus query Apify docs. Typical loop inside Claude Code:

1. Search/add the actor by id (e.g. `mhamas/luma-calendar-events-scraper`).
2. Call it with a small input (set a tiny `maxItems`/`maxEvents` while testing).
3. The MCP tool returns dataset items directly — no manual polling needed.

Use MCP for one-off discovery and field-shape checks. For the scheduled cron pipeline,
use REST (Path B) so runs are reproducible and pollable.

## Path B — REST (for the scraper pipeline)

Actor id in URLs is `username~actor-name` (tilde), e.g. `mhamas~luma-calendar-events-scraper`.

### Option B1 — sync, one call (small runs only)

```ts
// 300s HARD timeout -> HTTP 408 if exceeded. Good for maxItems<=10 smoke tests.
const items = await fetch(
  `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`,
  { method: 'POST', headers, body: JSON.stringify(input) },
).then((r) => r.json()); // -> array of dataset items
```

### Option B2 — async run + poll (robust; use for real scrapes)

```ts
// 1. Start the run
const run = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs`, {
  method: 'POST',
  headers,
  body: JSON.stringify(input),
}).then((r) => r.json());

const runId = run.data.id;
const datasetId = run.data.defaultDatasetId;

// 2. Poll until terminal. waitForFinish (0-60s) long-polls to cut request count.
let status = run.data.status;
while (!['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
  const r = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}?waitForFinish=60`,
    { headers },
  ).then((res) => res.json());
  status = r.data.status;
}
if (status !== 'SUCCEEDED') throw new Error(`Apify run ${runId} ended ${status}`);

// 3. Fetch results
const items = await fetch(
  `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true`,
  { headers },
).then((r) => r.json());
```

Alternative to tracking `runId`: `GET /v2/acts/${actorId}/runs/last` returns the most
recent run (handy after a cron-triggered run). Dataset query params: `format` (json),
`limit`, `offset`, `clean=true` (drops empty/hidden fields).

### Run states

`READY -> RUNNING -> SUCCEEDED` (terminal good). Terminal bad: `FAILED`, `TIMED-OUT`,
`ABORTED`. Only proceed to fetch items on `SUCCEEDED`.

## Actors + example inputs (always cap items while testing)

### Luma (lu.ma) — city/calendar pages

`mhamas/luma-calendar-events-scraper`. For `lu.ma/toronto` the calendar slug is just
`toronto` (NOT the full URL).

```json
{
  "slugs": ["toronto"],
  "dateFrom": "2026-06-08",
  "maxEvents": 5
}
```

Output per event: `slug`, `name`, `date` (YYYY-MM-DD), `timeUTC` (ISO 8601), `timeLocal`,
`city`, `url`, `text` (full page content). NOTE: the `text` field triggers the Website
Content Crawler per event and burns extra credits — leave it off / cap `maxEvents` low
while testing.

Alternative (keyword/search, monthly rental $29 — avoid for city pages):
`lexis-solutions/lu-ma-scraper` with `{ "query": "AI Toronto", "maxItems": 5, "location": "Toronto" }`.

### Eventbrite

`parseforge/eventbrite-scraper`. Search mode with filters:

```json
{
  "city": "toronto--ontario",
  "format": "networking",
  "online": false,
  "retrieveOrganizerData": true,
  "maxItems": 5
}
```

`maxItems` caps at 100 on the free tier. Output (20+ fields): `title`, start/end dates,
venue name, full address, `priceRange`, organizer name, category, format, `description`,
event URL, image URL, `isOnline`, `tags`, `scrapedAt`.

### Meetup

`easyapi/meetup-events-scraper`. Driven by Meetup search URLs:

```json
{
  "searchUrls": [
    "https://www.meetup.com/find/?location=ca--Toronto&source=EVENTS&keywords=tech"
  ],
  "maxItems": 5
}
```

Output per event: id, `title`, `url`, type (online/offline), `description`, datetime,
venue, group details (id/name/timezone/url), RSVP counts, featured photo, fee settings.

## Mapping raw output -> Event model (for the normalizer)

Align EXACTLY with `database/event.model.ts` field names. The model stores `date` as a
`YYYY-MM-DD` string and `time` as a 24h `HH:MM` string; `mode` is the enum
`online | offline | hybrid` (NOT "online/offline" booleans). Scraped sources often omit
`overview`/`agenda`/`audience` — those are being relaxed to optional for scraped events
(see canon's schema-extension diff). The new `url`, `source`, `sourceId`, `timezone`,
`fingerprint` fields are part of that diff.

| Event field   | Luma                         | Eventbrite                    | Meetup                          |
| ------------- | ---------------------------- | ----------------------------- | ------------------------------- |
| `title`       | `name`                       | `title`                       | `title`                         |
| `date`        | `date`                       | startDate -> `YYYY-MM-DD`     | datetime -> `YYYY-MM-DD`        |
| `time`        | `timeLocal` -> `HH:MM`       | startDate -> `HH:MM`          | datetime -> `HH:MM`             |
| `url`         | `url`                        | event URL                     | `url`                           |
| `venue`       | (from `text`/address)        | venue name + address          | venue                           |
| `city`        | `city`                       | address city                  | group / venue city              |
| `country`     | "Canada" (GTA default)       | address country               | group country                   |
| `description` | `text` (trim to 1000)        | `description` (trim to 1000)  | `description` (trim to 1000)    |
| `organizer`   | (from page)                  | organizer name                | group name                      |
| `tags`        | derive from `name`/`text`    | `tags`                        | social labels / keywords        |
| `mode`        | offline (city page)          | `isOnline` -> online/offline  | type online/offline             |
| `timezone`    | infer (America/Toronto)      | infer                         | group `timezone`                |
| `source`      | `"luma"`                     | `"eventbrite"`                | `"meetup"`                      |
| `sourceId`    | `slug`                       | event id                      | event id                        |

Normalizer rules (from canon):
- `mode`: map booleans/types to the enum. City-page Luma events default to `offline`.
- `date` must be `YYYY-MM-DD`, `time` must be 24h `HH:MM`. Bulk upserts do NOT run the
  model's `pre('save')` hook, so normalize date/time/slug in the normalizer before writing.
- Truncate `description` to <=1000 chars (model `maxlength`); `title` to <=100.
- `tags`: lowercase, dedupe, drop empties.
- Default `timezone` to `America/Toronto` when the source omits it (needed for calendar export).
- `fingerprint = sha256(lower(trim(title)) + "|" + date + "|" + lower(city))` — excludes
  time. Upsert with `Event.updateOne({fingerprint}, {$set,$setOnInsert}, {upsert:true})`
  or `bulkWrite([...], {ordered:false})`; treat duplicate-key `code === 11000` as benign.

## Free-tier budgeting (~$5/mo)

- Apify free plan ≈ **$5/month** platform credits; `parseforge/eventbrite-scraper`
  separately grants **$5 free credit** to new users.
- Pay-per-result actors are predictable: Eventbrite ~$4 / 1k results, Meetup ~$4.99 / 1k.
  One full 1k Eventbrite run can eat most of the monthly free credit.
- Luma's `text` field invokes the Website Content Crawler per event — extra compute. Cap it.
- **Always set a tiny `maxItems` / `maxEvents` (3-10) while developing**, verify field
  shapes and the run/poll plumbing on that sample, then raise the cap. Watch spend in
  Console -> Billing/Usage.

## Where this runs in the repo

- MCP config: `.mcp.json` (the `apify` server block).
- Scraper/normalizer code: server-only (API route under `app/api/.../route.ts` or a
  scheduled job). Reads `process.env.APIFY_TOKEN`; never expose it to the client.
- After fetching items: `await connectDB()` (`database/mongodb.ts`), normalize, then upsert
  via the `Event` model from `database/index.ts`. Route handlers need
  `export const runtime = 'nodejs'` because Mongoose uses the native TCP driver.
