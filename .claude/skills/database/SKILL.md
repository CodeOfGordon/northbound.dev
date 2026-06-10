---
name: database
description: Use when connecting to MongoDB/Mongoose, writing queries/upserts/aggregations, configuring indexes or Atlas Search, or using the MongoDB MCP server. Covers the cached connectDB pattern and the Event/Booking models.
---

# Database (MongoDB + Mongoose)

The DB is **MongoDB + Mongoose** (FINAL — no Postgres/Prisma). Working models already
exist; don't rewrite them, extend them. Verified versions: Mongoose `9.6.2`, mongodb
driver `7.2.0`, Next.js `16.2.6`.

Files (all under `database/`):

- `database/mongodb.ts` — default-export `connectDB()`, cached global connection.
- `database/event.model.ts` — `Event` model + `IEvent`.
- `database/booking.model.ts` — `Booking` model + `IBooking`.
- `database/index.ts` — barrel: `Event`, `Booking`, `IEvent`, `IBooking`.

Import from the barrel, connect from the source file:

```ts
import connectDB from '@/database/mongodb';
import { Event, Booking, type IEvent } from '@/database';
```

## The cached connection contract

`connectDB()` caches a single Mongoose connection on `global.mongoose` so warm
serverless instances and dev hot-reloads reuse one pool instead of exhausting Atlas's
connection limit. It uses `bufferCommands: false`, which makes any model op issued
before the connection is live **fail immediately** instead of silently buffering for 10s.
The contract this forces:

**`await connectDB()` must be the FIRST awaited line in every route handler / server
action — never at module top level** (top-level await would connect at build/prerender
time, not per request).

```ts
// app/api/events/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/database/mongodb';
import { Event } from '@/database';

export const runtime = 'nodejs';        // REQUIRED: Mongoose uses the native TCP driver, not Edge-safe
export const dynamic = 'force-dynamic'; // DB reads are per-request; GET handlers are dynamic by default in Next 16

export async function GET(request: NextRequest) {
  await connectDB();                    // first line; throws fast if URI missing/unreachable
  const events = await Event.find().sort({ date: 1 }).lean();
  return NextResponse.json(events);
}
```

`MONGODB_URI` is **server-only** — never prefix it with `NEXT_PUBLIC_`. Set it in
`.env.local`. The MCP server (below) uses a separate `MDB_MCP_CONNECTION_STRING`.

Two safe hardening tweaks to `database/mongodb.ts`: drop the unused
`import { cachedDataVersionTag } from 'v8';` on line 2, and pin the pool/timeouts:

```ts
const options = {
  bufferCommands: false,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 8000,
  socketTimeoutMS: 45000,
} satisfies mongoose.ConnectOptions;
```

Keep the existing failure handling that nulls `cached.promise` on a failed connect so the
next call retries.

## The models (PROJECT CANON — exact field names)

**Event** fields: `title` (≤100), `slug` (unique, auto-generated from `title` in a
`pre('save')` hook, lowercase), `description` (≤1000), `overview` (≤500), `image`,
`venue`, `country`, `city`, `date` (String, normalized `YYYY-MM-DD`), `time` (String,
normalized `HH:MM` 24h), `mode` (enum `online | offline | hybrid`), `audience`,
`agenda` (`String[]`), `organizer`, `tags` (`String[]`), plus `createdAt`/`updatedAt`.
Existing indexes: `slug` unique; `{ date: 1, mode: 1 }`.

**Booking** fields: `eventId` (ObjectId ref `Event`), `email` (validated, lowercase),
timestamps. Unique compound `{ eventId, email }` (one booking per email per event); plus
`{ eventId }`, `{ eventId, createdAt: -1 }`, `{ email }`.

> `pre('save')` hooks (slug + `normalizeDate` + `normalizeTime` on Event; event-exists
> check on Booking) fire **only on `.save()`/`.create()`** — NOT on `updateOne`,
> `updateMany`, or `bulkWrite`. For upserts you must normalize and compute the slug
> yourself before the call. Move `generateSlug`/`normalizeDate`/`normalizeTime` to
> exported pure functions and reuse them in the scraper.

## Aggregator schema extensions (propose as a DIFF, don't silently rewrite)

Add to `database/event.model.ts` for the scraper feed. `url` is **required** for this
product (canonical source link); relax `overview`/`agenda`/`audience` to optional since
scraped sources often omit them.

```ts
// add to IEvent
url: string;            // canonical event page on the source site (REQUIRED)
source: string;         // 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company'
sourceId?: string;      // platform id
fingerprint: string;    // dedup key
timezone: string;       // IANA, default 'America/Toronto' (for calendar export)
endDate?: string;       // YYYY-MM-DD
endTime?: string;       // HH:MM
isFree?: boolean;
price?: string;
category?: string;      // 'hackathon' | 'meetup' | 'conference' | 'networking'

// add to EventSchema fields
url:        { type: String, required: [true, 'Source URL is required'], trim: true },
source:     { type: String, required: true, enum: ['luma','eventbrite','meetup','mlh','company'] },
sourceId:   { type: String, trim: true },
fingerprint:{ type: String, required: true },
timezone:   { type: String, default: 'America/Toronto', trim: true },
endDate:    { type: String },
endTime:    { type: String },
isFree:     { type: Boolean },
price:      { type: String, trim: true },
category:   { type: String, enum: ['hackathon','meetup','conference','networking'] },
// and relax: drop `required` on overview, agenda, audience
```

## Dedup fingerprint + idempotent upsert

The scraper re-sees the same events, so writes must be idempotent. Fingerprint excludes
`time` (sources disagree by minutes):

```ts
import { createHash } from 'node:crypto';

// export from event.model.ts so the scraper builds the SAME fingerprint
export function buildFingerprint(e: { title: string; date: string; city: string }): string {
  const norm = `${e.title.trim().toLowerCase()}|${e.date}|${e.city.trim().toLowerCase()}`;
  return createHash('sha256').update(norm).digest('hex');
}

// unique sparse index — the dedup key
EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });
```

Single upsert: `$set` for fields that may change each scrape, `$setOnInsert` for
create-only fields:

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
      timezone: scraped.timezone ?? 'America/Toronto',
    },
    $setOnInsert: {                  // only on first insert
      fingerprint, source: scraped.source,
      slug: generateSlug(scraped.title),  // hook does NOT run — compute it yourself
    },
  },
  { upsert: true },
);
```

Batch upsert with `bulkWrite` (one round trip; `ordered: false` so one bad doc doesn't
abort the rest):

```ts
const ops = batch.map((s) => {
  const fingerprint = buildFingerprint(s);
  return {
    updateOne: {
      filter: { fingerprint },
      update: { $set: { /* mutable fields */ }, $setOnInsert: { fingerprint, source: s.source, slug: generateSlug(s.title) } },
      upsert: true,
    },
  };
});
const res = await Event.bulkWrite(ops, { ordered: false });
// res.upsertedCount, res.modifiedCount, res.matchedCount
```

## E11000 handling (the unique-index race)

Two concurrent upserts with the same `fingerprint` can both miss the lookup and both try
to insert; the unique index rejects the second with **`E11000 duplicate key`**
(`err.code === 11000`). This is the index doing its job — the data is NOT duplicated.
Treat it as benign:

```ts
// single updateOne: retry once (now it matches the existing doc → plain $set update)
async function upsertEvent(filter: object, update: object, retries = 1): Promise<void> {
  try {
    await Event.updateOne(filter, update, { upsert: true });
  } catch (err: any) {
    if (err?.code === 11000 && retries > 0) return upsertEvent(filter, update, retries - 1);
    throw err;
  }
}

// bulkWrite (ordered:false): successful upserts still commit; ignore 11000 writeErrors
function handleBulkError(err: any) {
  if (err?.name === 'MongoBulkWriteError') {
    const fatal = (err.writeErrors ?? []).filter((e: any) => e.err?.code !== 11000);
    if (fatal.length) throw err;
    return; // all errors were benign dup-key races
  }
  throw err;
}
```

Distinguish *which* index fired via `err.keyPattern` / `err.keyValue` (e.g. a `slug`
collision vs a `fingerprint` collision).

## Filtered feed query + `.lean()`

`date` is a fixed-width `YYYY-MM-DD` string, so a lexical `$gte`/`$lte` range equals a
chronological range — no `Date` conversion needed. Always `.lean()` on list reads
(returns POJOs, skips Mongoose hydration — big CPU/memory win, serializes straight to
JSON):

```ts
import type { FilterQuery } from 'mongoose';

const sp = request.nextUrl.searchParams;
const filter: FilterQuery<IEvent> = {};

const mode = sp.get('mode');
if (mode && ['online', 'offline', 'hybrid'].includes(mode)) filter.mode = mode;

const city = sp.get('city');
if (city) filter.city = { $regex: `^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };

const tags = sp.getAll('tag');
if (tags.length) filter.tags = { $in: tags };

const from = sp.get('from'), to = sp.get('to');
if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

const limit = Math.min(Math.max(Number(sp.get('limit')) || 20, 1), 100);
const page = Math.max(Number(sp.get('page')) || 1, 1);

const [items, total] = await Promise.all([
  Event.find(filter).sort({ date: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
  Event.countDocuments(filter),
]);
return NextResponse.json({ items, page, limit, total });
```

For infinite scroll prefer a `(date, _id)` cursor over `skip` (skip re-scans skipped docs
and gets linearly slower with depth): match `$or: [{ date: { $gt: cursorDate } }, { date: cursorDate, _id: { $gt: cursorId } }]`,
fetch `limit + 1` to detect a next page.

## Full-text: `$text` index vs Atlas Search

**Start with a Mongoose `$text` index** (zero infra, works on local dev and any
MongoDB, lives in the schema). Only ONE text index per collection:

```ts
EventSchema.index(
  { title: 'text', description: 'text', tags: 'text' },
  { weights: { title: 10, tags: 5, description: 1 }, name: 'event_text' },
);

// query, sorted by relevance
const results = await Event.find(
  { $text: { $search: q } },
  { score: { $meta: 'textScore' } },
).sort({ score: { $meta: 'textScore' } }).limit(limit).lean();
```

Graduate to **Atlas Search** (`$search` aggregation stage) only when you need typo
tolerance / autocomplete — it's Atlas-only (breaks local dev unless dev also points at
Atlas) and the index is defined in Atlas, not the schema:

```ts
const results = await Event.aggregate([
  { $search: { index: 'events_search', compound: { should: [
    { text: { query: q, path: 'title', score: { boost: { value: 5 } } } },
    { text: { query: q, path: ['description', 'tags'] } },
    { autocomplete: { query: q, path: 'title' } },
  ] } } },
  { $limit: limit },
  { $project: { title: 1, slug: 1, date: 1, city: 1, score: { $meta: 'searchScore' } } },
]);
```

Pick ONE path per query — don't rely on both a `$text` index and `$search` for the same
need.

## Recommended indexes

Apply the **ESR rule** (Equality, Sort, Range) to compound order. The existing
`{ date: 1, mode: 1 }` is backwards for "filter by mode, range/sort by date" — replace it.

```ts
EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true }); // dedup key
EventSchema.index({ date: 1, _id: 1 });   // primary sort + cursor pagination
EventSchema.index({ mode: 1, date: 1 });  // replaces { date: 1, mode: 1 }
EventSchema.index({ city: 1, date: 1 });
EventSchema.index({ tags: 1, date: 1 });  // multikey for $in tag filters
// + the event_text index above; add { isFree: 1, date: 1 } when isFree lands
```

Don't over-index — each one slows scraper writes and consumes RAM. In production set
`autoIndex: false` in the schema options and build indexes via `Event.syncIndexes()` on
deploy (foreground auto-builds on a hot path are dangerous in prod):

```ts
{ timestamps: true, autoIndex: process.env.NODE_ENV !== 'production' }
```

## MongoDB MCP server (dev only)

Use the official `mongodb-mcp-server` for schema inspection, ad-hoc queries, and
migrations during development. It's configured in `.mcp.json` at repo root:

```json
"mongodb": {
  "command": "npx",
  "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
  "env": { "MDB_MCP_CONNECTION_STRING": "${MDB_MCP_CONNECTION_STRING}" }
}
```

- Connection string env var is `MDB_MCP_CONNECTION_STRING` (separate from the app's
  `MONGODB_URI`); or pass `--connectionString`. No paid key needed — just your Atlas/Mongo
  connection string.
- `--readOnly` disables create/update/delete (read/connect/metadata only) — keep it for
  inspection and ad-hoc queries. **Remove `--readOnly` only when intentionally running a
  migration/write**, then put it back.

Use it to: inspect collection schemas, list indexes (verify the ESR indexes above exist),
run sample aggregations before coding them, and apply index migrations
(`syncIndexes`-equivalent) against a dev/staging cluster — not production from your laptop.
