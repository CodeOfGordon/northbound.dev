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

### Luma
- `lu.ma/sf`, `lu.ma/toronto` etc. are **city discovery pages** (calendar slugs) — scrape these, not individual event pages. For `mhamas/luma-calendar-events-scraper` the `slugs` input is the bare slug (`toronto`), NOT the full URL.
- Luma events sometimes have `null` end times — treat as single-day / all-day events (omit `endTime` rather than passing null; see Calendar Button).
- Luma timezone is usually in the event object but sometimes missing; default to `America/Toronto` (our focus region) and log a warning.
- Luma private events will 404 the scraper; skip gracefully.
- The calendar scraper's `text` field pulls in the Website Content Crawler per event and burns extra credits — disable/cap it during testing.

### Eventbrite
- Eventbrite requires a search query or category — don't scrape the homepage. Use `parseforge/eventbrite-scraper` search mode with `city` slug (e.g. `toronto--ontario`), `category`, `format`, `price`.
- The free Apify tier caps Eventbrite at **100 items**; batch by city to avoid timeouts.
- Eventbrite "online" events still set location to the string `"Online"`, not null — map `isOnline`/`isOnline === true` to `mode: 'online'`, don't trust the location field.

### Meetup
- Meetup.com heavily rate-limits; Apify actors (`easyapi/meetup-events-scraper`) handle proxy rotation automatically.
- Group URLs vs. event-search URLs behave differently in actors — feed `searchUrls`.
- RSVP counts can be stale by hours; don't treat them as live.

### General scraping
- Run every actor with a small cap (`maxItems`/`maxEvents` = 3–10) on first test, verify field shapes + the run/poll plumbing, then increase.
- Run-status polling: prefer `GET /v2/actor-runs/{runId}` (optionally `?waitForFinish=60`), or `GET /v2/acts/{actorId}/runs/last` to fetch the most recent run — run IDs are per-invocation.
- The sync endpoint `run-sync-get-dataset-items` has a hard **300 s timeout** (HTTP 408 on overrun) — use async run + poll for anything that crawls many pages.
- Pass the token as a header — `Authorization: Bearer <APIFY_TOKEN>` — never `?token=` (it leaks into logs). Read it from `process.env.APIFY_TOKEN`.
- Apify free tier: ~$5/month compute credit; pay-per-result actors are predictable (Eventbrite ~$4/1k, Meetup ~$4.99/1k). One full Eventbrite run can eat the whole monthly credit — keep caps small while developing.
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
