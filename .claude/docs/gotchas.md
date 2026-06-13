# Gotchas & Known Issues

Project-specific traps for the Tech Event Aggregator (DevEvents). Read this before
touching scraping, dedup, the calendar button, MongoDB, or Next.js route handlers.

> Stack reality check: this is a **heavily modified Next.js 16.2.6** whose APIs differ
> from training data. For any Next.js code, the bundled docs at
> `node_modules/next/dist/docs/01-app` are the source of truth — read them before
> writing route handlers, data fetching, or config. Database is **MongoDB + Mongoose**
> (Mongoose 9.6.2, mongodb driver 7.2.0). There is no Supabase/Postgres anywhere.

---

## Scraping

### Luma (direct public API — no Apify; see ADR-009)
- `GET api.lu.ma/url?url=<slug>` resolves a slug. `kind` is `discover-place` (toronto, montreal), `calendar` (ottawa, company calendars) or something else (user pages — reject). `quebec-city` → 404 (no such discovery page).
- Events: `discover/get-paginated-events?discover_place_api_id=…&pagination_limit=N` and `calendar/get-items?calendar_api_id=…&period=future&pagination_limit=N`. Entries nest the event plus entry-level `calendar` / `hosts` / `ticket_info` — the fetcher flattens them into one raw object.
- `start_at`/`end_at` are **UTC ISO** — convert with the event's `timezone` (a 12:00Z start is 08:00 Toronto; naive UTC date-split shifts evening events to the next day).
- List entries have **no description** (schema requires one — synthesize) and `geo_address_info.mode: "obfuscated"` hides street addresses (fall back to sublocality/city).
- Beware misleading vanity slugs: `lu.ma/cohere` is a coliving community, NOT Cohere AI (their calendar is `cal-400NOkbFqzrkJNA`). Verify a calendar belongs to the company before adding it to the registry.

### Eventbrite (`parseforge/eventbrite-scraper`)
- Search mode city slug format is `country--city`: **`canada--toronto`** (NOT `toronto--ontario`); category `science-and-tech`. One run per city.
- Item dates are **already local**: `startDate` `YYYY-MM-DD` + `startTime` `HH:MM` + `timezone` — store as-is, no conversion.
- `isOnline === true` is the online signal — the venue strings still say "Online", don't trust them.
- `pricing.isFree` can be `false` with all price fields `null` — treat as unknown-paid, don't infer free.
- The free Apify tier caps Eventbrite at **100 items**; batch by city to avoid timeouts.

### Meetup (`easyapi/meetup-events-scraper`) — billing traps, learned the expensive way
- **The `maxItems` INPUT field is advisory and the actor ignores it** — a 12-URL run requested 20 items, collected 186+, and billed ~$1.39. The REAL cap is the **`?maxItems=` run option** on the start request (`POST /v2/acts/{id}/runs?maxItems=N`) — Apify enforces billing there. `lib/fetchers/apify.ts` always sets it.
- Pay-per-event actors charge the start fee **per GB of memory** — this actor defaults to 4 GB = 4× the $0.09 start fee. Pass `?memory=2048` (peak observed ~1.3 GB).
- The actor crawls search URLs **sequentially at ~1 min each** — keep the URL list to ~4 (one umbrella `tech` search per city; the relevance gate classifies). The refresh route has a 300 s ceiling in production, which is also why the cron triggers each source in a separate POST.
- `dateTime` is ISO **with offset** (`2026-06-11T17:30:00-04:00`); `eventType` is `PHYSICAL`/`ONLINE`; `venue.country` is lowercase `ca`; `feeSettings == null` ⇒ free.
- Group URLs vs. event-search URLs behave differently in actors — feed `searchUrls`.
- RSVP counts can be stale by hours; don't treat them as live.

### MLH (direct fetch — no Apify)
- Season pages (`mlh.io/seasons/2026/events`) embed the full event list as a JSON array (`[{"id":"…`): `name`, `startsAt`/`endsAt` UTC ISO, `venueAddress{city,state,country}`, `formatType` `physical|digital`, `websiteUrl`, `status`. Extract with a balanced-bracket scan from the `[{"id":"` marker — no HTML parser needed.
- Pages list the whole season including `status: "ended"` events — filter on status + end date.
- Digital events are "Everywhere, Worldwide" (sometimes country `US`) — store as city `Online`, keep them (joinable from anywhere).

### Company platform feeds (`lib/fetchers/companies/` — all live-verified 2026-06-10/11)
- **curl is NOT a valid smoke test for Tesla or Databricks.** Both sit behind TLS-fingerprinting CDNs (Akamai / Cloudflare) that 403 every curl request regardless of headers, while Node's native fetch passes with a browser-ish UA. Test with `npx tsx`, never curl. Conversely the production runtime (Node fetch) is exactly the client that works.
- **NVIDIA + Figma robots.txt blanket-block AI-crawler UA tokens** (anthropic-ai, GPTBot, ...). Those adapters send `BROWSER_UA` from `companies/shared.ts`, not the DevEventsBot UA in `util.ts`.
- **Google devsite randomly machine-translates** `developers.google.com/events` (observed th/pt-BR/ko on back-to-back requests), which translates the h3 slugs used as ids. Pin `?hl=en` + `accept-language: en-US`. Gallery dates are free text without year ("June 9-10 (Frankfurt) | In-person") — year inference + Dec→Jan wrap handled in the adapter; explicit ", YYYY" suffixes win.
- **Microsoft Reactor API** is `/reactor/api/events` with NO culture prefix (`/en-us/reactor/api/...` 404s). 10 items/page regardless of the UI's 9. Instants are true UTC but there is **no per-event IANA zone** — events render in UTC wall-clock. `formats=In person` filter value has a space. `isSeries` items are skipped.
- **Tesla dates are faux-UTC**: `dates[].startDate` is the local calendar date encoded at `T00:00:00+00:00` — never treat it as an instant; the real zone is `locations[0].timezone` and the real clock time only exists in the human `hours` string ("11 AM - 5 PM"). lat/lng params are REQUIRED (412 without); events are radius-scoped per city centroid (registry lists Toronto + Montreal).
- **Databricks page-data is ~2.25 MB** and `eventsEN` still contains Korean/Japanese items (CJK titles dropped in the adapter) plus one item with null `fieldDateTimeTimezone` (guarded). The time-of-day in `fieldDateTimeTimezone` is a CMS save artifact — date-only.
- **NVIDIA's AEM calendar is hand-edited**: mixed date formats (YYYY-MM-DD, M/D/YY, MM-DD-YY, MM-DD-YYYY, literal 'TBC'), trailing-space regions, mostly empty urls, no ids/images. `parseLooseUSDate` in `companies/shared.ts`; items whose start won't parse are skipped.
- **Snowflake**: parse `__INITIAL_STATE__` from the developers/events page — the cleaner `_jcr_content/...filter.json` API works but matches `Disallow: /*/_jcr_content/` in robots.txt, so don't use it. `eventDate` is 'DD MON' with no year → resolve to next occurrence (the feed is upcoming-only). Location typos exist ('Syndey').
- **Figma**: events live in RSC flight chunks (`self.__next_f.push`) — take the FIRST `eventListLego` occurrence with an inline events array (later ones are `$`-refs). Tied to Next flight encoding + Sanity type names; the adapter deliberately THROWS on zero extraction so the registry logs it instead of silently going quiet.
- **YC has no public event index.** `workatastartup.com/events` `props.eventsUpcoming` is usually empty; the registry MUST seed `slugs` (e.g. `startup-school-2026`) or the adapter yields 0. Discover new slugs via Brave search `site:events.ycombinator.com` or the YC blog tag, then add to config.
- **Scraper slugs include the event date** (`lib/scrape.ts`): recurring series (Reactor, Figma webinars) reuse titles across dates; a bare-title slug hits the unique index and silently drops later occurrences as benign-looking E11000s.
- **Luma vanity-slug squatting is rampant**: lu.ma/cohere is a coliving community, lu.ma/modal is unrelated (Modal is `modal-labs`). Always resolve the slug, check the calendar's display name, and prefer pinning `calendar_api_id` in config.

### Geo classification + North-America scope (ADR-015)
- The stored `country` from company adapters is unreliable (most were 'TBA' — adapters capture a city, not a country). The authoritative location signal is the **`city` string**, classified by `lib/fetchers/geo.ts` → `classifyRegion`. Don't filter on raw `country`.
- `normalize.ts` sets the persisted **`region`** field (`CA|US|ONLINE|INTL|UNKNOWN`) for every source; `lib/scrape.ts` drops `region === 'INTL'` BEFORE upsert. So foreign events never reach the DB — if you re-add a global source, expect ~⅓ of items to be gated out, and that's correct.
- Non-NA collapse: `normalize.ts` maps `isNorthAmerica === false` (incl. online events whose `_regions` hint excludes North America, e.g. Microsoft "Build Digital Recap (APAC)") to `region: 'INTL'`. Online events with NO region hint stay (joinable from anywhere).
- **Re-scraping does NOT delete already-stored foreign events** — upsert only touches matching fingerprints, and gated items are skipped entirely. After tightening the gate you must wipe (`deleteMany({source:'company'})`) and re-scrape, or backfill `region` on existing docs. (A throwaway `tsx` script in the repo root works; `mongoose.connection.db.collection('events')` avoids model-schema stripping. Wrap in an async IIFE — tsx compiles `.ts` as CJS and rejects top-level await.)
- `cleanTitle` (geo.ts) is applied to ALL titles in `normalize.ts` (so slugs/fingerprints use the cleaned title consistently). It only repairs run-together `letter:lowercase` (→ `: Uppercase`), decodes entities, and trims — it deliberately does NOT re-case words, so brand titles survive.
- 'London' is the UK by default; only 'London, ON'/'London, Ontario' is the Canadian city. Mexico is treated as INTL (product = Canada + US). Source city typos (e.g. Snowflake 'Syndey') fall through as `UNKNOWN` and are kept — accept it, don't chase typos in the city DB.
- The MongoDB MCP server is **read-only** (`.mcp.json` `--readOnly`) — deletes/backfills need a `tsx` script, not the MCP.

### General scraping
- Run every actor with a small cap on first test, verify field shapes + the run/poll plumbing, then increase. Set the cap as the **`?maxItems=` run option** (billing-enforced), not just the actor input (advisory — see Meetup above).
- Always pass a **server-side `?timeout=` run option** matching your poll deadline — a client-side poll timeout alone leaves the actor running (and billing) on Apify. Abort orphaned runs (`POST /v2/actor-runs/{id}/abort`).
- Run-status polling: prefer `GET /v2/actor-runs/{runId}` (optionally `?waitForFinish=60`), or `GET /v2/acts/{actorId}/runs/last` to fetch the most recent run — run IDs are per-invocation.
- The sync endpoint `run-sync-get-dataset-items` has a hard **300 s timeout** (HTTP 408 on overrun) — use async run + poll for anything that crawls many pages.
- Pass the token as a header — `Authorization: Bearer <APIFY_TOKEN>` — never `?token=` (it leaks into logs). Read it from `process.env.APIFY_TOKEN`.
- Apify free tier: ~$5/month credit, and it goes FAST (one runaway meetup run ate ~$1.40; the 2026-06 validation exhausted the month). `SCRAPE_MAX_ITEMS` caps every source; the cron runs paid sources weekly, free sources nightly.
- Always check `run.status === 'SUCCEEDED'` before fetching dataset items.
- **`pre('save')` hooks do NOT run on scraper upserts** — normalize `date`/`time`/`slug` yourself before writing. See the MongoDB section.

---

## Deduplication

- Dedup key is **`fingerprint`** = `sha256( title.toLowerCase().trim() + "|" + date(YYYY-MM-DD) + "|" + city.toLowerCase() )`.
- **Exclude `time`** from the fingerprint — sources disagree by minutes (Luma says 9:00, Eventbrite says 9:30 for the same event).
- Upsert on `fingerprint`, NOT on `sourceId` — the same event can appear on Luma *and* Meetup *and* Eventbrite; you want one canonical document.
- The scraper must compute the **same** fingerprint the model expects. Keep one exported helper and call it everywhere:

```ts
import { createHash } from 'node:crypto';

export function buildFingerprint(e: { title: string; date: string; city: string }): string {
  const norm = `${e.title.trim().toLowerCase()}|${e.date}|${e.city.trim().toLowerCase()}`;
  return createHash('sha256').update(norm).digest('hex');
}
```

- The index on `fingerprint` is **unique + sparse** so legacy/hand-entered events without a fingerprint don't collide on `null`. See the MongoDB section for why sparse matters.
- Concurrent scrapes of the same event are expected to throw **E11000** on the unique index — that's the index doing its job, not a bug. Handle it (below), don't pre-check.

---

## Calendar Button

Library: `add-to-calendar-button-react` v2.14.0 (named export, NOT default). The core is a Web Component, so it is **client-only**.

```tsx
'use client';
import { AddToCalendarButton } from 'add-to-calendar-button-react';
```

- Must live in a `"use client"` component — it touches `window`/`document` and registers a custom element; it must never run during SSR.
- Field mapping from our Event model: `Event.date -> startDate` (`YYYY-MM-DD`), `Event.time -> startTime` (`HH:MM`, 24h), `Event.timezone -> timeZone` (IANA, e.g. `"America/Toronto"`). These match our stored formats exactly — no conversion needed.
- `options` is passed as a **real array** (React wrapper), e.g. `options={['Apple','Google','iCal','Outlook.com','Yahoo']}`. Accepted values: `'Apple' | 'Google' | 'iCal' | 'Microsoft365' | 'MicrosoftTeams' | 'Outlook.com' | 'Yahoo'`.
- `timeZone` must be a valid IANA string (`"America/Toronto"`), not a UTC offset. Required whenever you supply times so DST is handled.
- `startTime`/`endTime` format is `"HH:MM"` (24h) — NOT an ISO string, no seconds, no AM/PM.
- **No open-ended timed events.** If you have a `startTime` you must also give an `endTime`. If end time is unknown, either drop BOTH times (the lib makes it all-day) or default `endTime = startTime + 1h`. Passing `null` causes a render error.
- Google Calendar opens a new tab — some browsers block it unless triggered by a direct user click. Apple downloads an `.ics`, which needs a default calendar app on the device.
- **Hydration mismatch fix:** even inside `"use client"` the custom element can produce a "Hydration failed" warning. The robust cure is to skip SSR with a dynamic import:

```tsx
'use client';
import dynamic from 'next/dynamic';

const AddToCalendarButton = dynamic(
  () => import('add-to-calendar-button-react').then((m) => m.AddToCalendarButton),
  { ssr: false }
);
```

> `dynamic(..., { ssr: false })` is only allowed inside a Client Component in App Router. This is exactly the kind of API the Next.js fork may have changed — verify `next/dynamic` usage against `node_modules/next/dist/docs/01-app` before relying on it.

---

## Database / MongoDB + Mongoose

Existing code: `database/mongodb.ts` (cached `connectDB()`), `database/event.model.ts`,
`database/booking.model.ts`, `database/index.ts` (barrel: `Event`, `Booking`, `IEvent`, `IBooking`).

### Cached connection in serverless — do not "fix" it
`mongodb.ts` caches the connection on `global.mongoose`. This is correct and required:
each warm Lambda/container reuses the cached connection instead of opening a new pool on
every invocation (which would exhaust Atlas's connection limit), and it also survives dev
hot reloads. Don't move the connect call to module top level — connect **inside** the
handler so it runs per-request on potentially-cold instances.

- **`bufferCommands: false` is deliberate.** Mongoose normally buffers queries issued before the connection is live and replays them — in serverless that silently stalls until `bufferTimeoutMS` (~10 s) and then throws a confusing `Operation ... buffering timed out`. With buffering off, a query before connect fails *immediately and loudly*. The contract that follows: **`await connectDB()` must be the first awaited line in every route handler / server action.**
- Mongoose uses the native TCP driver — it cannot run on Edge. Every route that touches the DB needs `export const runtime = 'nodejs'`.
- Note the existing file has a stray `import { cachedDataVersionTag } from 'v8';` (unused). Optional hardening: add `maxPoolSize: 10`, `serverSelectionTimeoutMS: 8000`, `socketTimeoutMS: 45000` to the options object.

```ts
// app/api/events/route.ts
import connectDB from '@/database/mongodb';
import { Event } from '@/database';

export const runtime = 'nodejs';        // REQUIRED — Mongoose can't run on Edge
export const dynamic = 'force-dynamic'; // DB reads are per-request (and GET is dynamic by default in Next 16)

export async function GET(request: Request) {
  await connectDB();                    // first awaited line; throws fast if URI missing/unreachable
  // ...query
}
```

### date and time are stored as STRINGS
This is the single most surprising thing about the schema. `Event.date` is a **String**
normalized to `YYYY-MM-DD`; `Event.time` is a **String** normalized to `HH:MM` (24h).
They are NOT `Date` objects.

- Because the date format is zero-padded and fixed-width, **lexical comparison equals chronological comparison** — a `$gte`/`$lte` string range filters by date correctly with no `Date` conversion:

```ts
filter.date = { $gte: '2026-06-01', $lte: '2026-12-31' }; // works because YYYY-MM-DD sorts lexically
```

- Don't call `new Date(event.date)` and expect a timezone-correct instant — there's no time/zone embedded. Calendar export reads `date`/`time`/`timezone` as the separate strings they are.

### pre('save') hooks DON'T fire on upserts/bulkWrite
The slug / date / time normalization in `event.model.ts` runs only on `.save()` / `.create()`.
`updateOne`, `updateMany`, and `bulkWrite` **bypass it entirely**. The scraper uses upserts,
so it must normalize `date -> YYYY-MM-DD`, `time -> HH:MM`, and compute `slug` + `fingerprint`
itself before writing. Move `generateSlug` / `normalizeDate` / `normalizeTime` to exported pure
functions and call them in the scraper.

### Idempotent upsert on fingerprint
`$set` mutable fields (refreshed each scrape), `$setOnInsert` create-only fields:

```ts
await connectDB();
const fingerprint = buildFingerprint(scraped);

await Event.updateOne(
  { fingerprint },
  {
    $set: {                          // refreshed every scrape
      title: scraped.title, description: scraped.description, image: scraped.image,
      venue: scraped.venue, country: scraped.country, city: scraped.city,
      date: scraped.date, time: scraped.time, mode: scraped.mode,
      tags: scraped.tags, organizer: scraped.organizer, url: scraped.url,
    },
    $setOnInsert: {                  // only on first insert
      fingerprint, source: scraped.source, slug: makeUniqueSlug(scraped.title),
    },
  },
  { upsert: true }
);
```

For a batch, use `bulkWrite` with **`ordered: false`** so one bad doc doesn't abort the rest:

```ts
const res = await Event.bulkWrite(ops, { ordered: false });
// res.upsertedCount, res.modifiedCount, res.matchedCount
```

### Upsert race conditions and E11000
Two concurrent upserts with the same `fingerprint` can both miss the lookup, both try to
insert, and the unique index rejects the second with **E11000 duplicate key error**
(`err.code === 11000`). This is **expected and safe** — the data isn't duplicated.

- Single `updateOne`: catch `code === 11000` and retry once — the retry now matches the existing doc and does a plain `$set` update.
- `bulkWrite({ ordered: false })`: failures collect into a `MongoBulkWriteError`; successful upserts still commit. Filter `err.writeErrors` and ignore the 11000s:

```ts
function handleBulkError(err: any) {
  if (err?.name === 'MongoBulkWriteError') {
    const fatal = (err.writeErrors ?? []).filter((e: any) => e.err?.code !== 11000);
    if (fatal.length) throw err;  // real failures only
    return;                       // benign dup-key races
  }
  throw err;
}
```

- The same 11000 can fire on the **`slug`** unique index when two different events share a title. Distinguish which index fired via `err.keyPattern` / `err.keyValue`, and have `makeUniqueSlug` append a short fingerprint suffix on collision.

### Unique SPARSE index on fingerprint
Define the dedup index as both unique and sparse:

```ts
EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });
```

Without `sparse`, a plain unique index treats a missing field as `null` and lets **only one**
document omit `fingerprint` — any legacy / hand-entered event without one would collide on
`null`. `sparse` skips documents that lack the field, so the uniqueness applies only to
real fingerprints.

### ObjectId pitfalls
- `Booking.eventId` is an `ObjectId` ref to `Event`. A 24-char hex **string** from a query param is NOT an ObjectId — comparisons and `$in` against the stored `_id` silently match nothing unless you convert: `new mongoose.Types.ObjectId(id)`. Wrap in `mongoose.isValidObjectId(id)` first to avoid throwing on bad input.
- After `.lean()`, `_id` is an `ObjectId` instance, not a string — call `String(doc._id)` before sending it to the client or using it as a React key / cursor.
- The unique compound index `{ eventId, email }` on Booking enforces one booking per email per event — a duplicate booking throws E11000, same handling as above.

### Atlas Search vs $text index
Two full-text options for `title` / `description` / `tags`:

- **`$text` index (start here).** One text index per collection, defined in the schema, with field weights. Works on any MongoDB including local dev. Stemming + stop words + relevance, but no fuzzy/typo tolerance, no autocomplete, no substring match.

```ts
EventSchema.index(
  { title: 'text', description: 'text', tags: 'text' },
  { weights: { title: 10, tags: 5, description: 1 }, name: 'event_text' }
);
// query: Event.find({ $text: { $search: q } }, { score: { $meta: 'textScore' } })
//   .sort({ score: { $meta: 'textScore' } })
```

- **Atlas Search (`$search` aggregation stage).** Lucene-backed: fuzzy/typo tolerance, autocomplete, synonyms, multiple indexes. But it is **Atlas-only** — it does not exist on local/self-hosted Mongo, so `next dev` against a local DB breaks unless dev also points at Atlas. It's eventually consistent (just-written docs take a moment to be searchable) and the index is defined in Atlas, not the schema.

**Recommendation:** ship `$text` first; graduate to Atlas Search only when the UI needs typo tolerance or autocomplete. Don't maintain both for the same query.

### Indexes & autoIndex
- Existing: `slug` unique, compound `{ date: 1, mode: 1 }`. That compound is **backwards** for the dominant "filter by mode, range/sort by date" query — prefer `{ mode: 1, date: 1 }` (ESR rule: Equality, Sort, Range). Add `{ date: 1, _id: 1 }` for the no-filter paginated feed, plus `{ city: 1, date: 1 }` and `{ tags: 1, date: 1 }`.
- Mongoose auto-builds indexes on model init (`autoIndex`), which can trigger a foreground build on a hot path in prod. Set `autoIndex: process.env.NODE_ENV !== 'production'` in schema options and run `Event.syncIndexes()` on deploy.

### normalizeDate UTC-shift bug — FIXED (2026-06-10)
`normalizeDate`/`normalizeTime` (`database/normalize.ts`, reused by the model's pre-save
hook) now extract wall-clock parts in the event's IANA timezone via `Intl.DateTimeFormat`
(`hourCycle: 'h23'`). Date-only strings ("June 15, 2026") are read back with local getters —
running them through a timezone conversion is what used to shift the day. Pass the event's
timezone as the second argument; it defaults to `America/Toronto`.

### Mongoose 9 breaking changes (verified against installed 9.6.2 types)
- **Middleware has no `next()` callback.** `pre('save', fn)` receives `(this, opts: SaveOptions)` — typing the param as `next` and calling it is a TS error (`SaveOptions has no call signatures`). Return (or resolve) to continue; **throw** to abort with an error.
- **`FilterQuery` was renamed `QueryFilter`.** `import type { QueryFilter } from 'mongoose'`.
- `QueryFilter` is strict on enum-typed fields — a raw `searchParams.get()` string won't assign to `filter.category`/`filter.source`; whitelist-validate then cast to `IEvent['category']` etc.

---

## Next.js / API

> Next.js 16 mental model: **nothing is cached by default**, and request-time APIs are async.

- **GET route handlers are NOT cached by default** in Next 16 (changed from static). Opt into caching only deliberately: `export const dynamic = 'force-static'` or `export const revalidate = 60`. The events feed wants fresh data — leave it dynamic.
- **`fetch` is NOT cached by default.** It fetches every request (and blocks render). Add `{ next: { revalidate: n } }` or `{ cache: 'force-cache' }` to cache, `{ cache: 'no-store' }` to force dynamic. `fetch` memoization does NOT apply inside route handlers (they're outside the React tree).
- **`params` and `searchParams` are Promises — await them.** The v15 sync shim is removed in v16:

```ts
// route handler
export async function GET(req: Request, { params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
}
// page
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { q } = await searchParams;
}
```

- Read query params in a handler via `request.nextUrl.searchParams.get('q')` (the request is a `NextRequest`).
- `cookies()`, `headers()`, `draftMode()` from `next/headers` are all async now — `await` them.
- **Cron auth + method:** the refresh trigger is **`POST /api/refresh`** (ADR-007 / `AGENTS.md`), and the scheduler must send `Authorization: Bearer ${process.env.CRON_SECRET}` — validate it before running the scrape. Caveat: **Vercel Cron only issues `GET`** requests, so it can't hit a POST handler. Either trigger via **GitHub Actions** (which can POST — the documented default for finer-than-daily cadence) or, if you specifically want Vercel Cron, expose the handler as `GET` instead. Pick one verb and keep ADR-007 + the handler in sync.
- Any route using Mongoose / `node:crypto` must be `export const runtime = 'nodejs'` — do NOT set `runtime = 'edge'`.
- `middleware` was renamed to **`proxy`** in v16 (nodejs runtime only, no edge). Turbopack is the default for `next dev`/`next build`. Use `connection()` before reading `process.env` if you need a guaranteed runtime (not build-time) read.

---

## Deployment

- Secrets are **server-only** — NO `NEXT_PUBLIC_` prefix: `MONGODB_URI`, `APIFY_TOKEN`, `CRON_SECRET`, `BRAVE_API_KEY`. Set them in Vercel project env vars.
- The MongoDB MCP server reads `MDB_MCP_CONNECTION_STRING` (separate from the app's `MONGODB_URI`); `.mcp.json` runs it with `--readOnly`.
- Atlas: whitelist the deploy platform's egress IPs (or `0.0.0.0/0` for serverless where IPs are dynamic), and keep `maxPoolSize` modest so many concurrent functions don't blow the cluster's connection cap.
- Vercel free-tier cron: minimum interval is once per day (`0 0 * * *`). For tighter schedules self-host the cron (GitHub Actions on schedule, Railway cron, etc.) hitting the scrape route with the `CRON_SECRET`.
- Create indexes intentionally on deploy (`Event.syncIndexes()`) with `autoIndex: false` in production — don't let a cold start trigger a foreground index build.
