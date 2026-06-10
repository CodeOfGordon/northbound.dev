---
name: backend-api
description: Use when writing Next.js 16 App Router route handlers - the GET /api/events filter/search query, GET /api/events/[slug], and the POST /api/refresh cron endpoint with CRON_SECRET auth. Read the local Next 16 docs first.
---

# Backend API route handlers (Next.js 16 App Router)

DevEvents (Tech Event Aggregator) backend. These handlers serve the normalized event
feed and trigger the scraper. MongoDB + Mongoose is the database — never Supabase/Postgres.

## READ FIRST (source of truth)

This is a **modified Next.js 16.2.6** — its APIs differ from your training data. Before
writing any handler, read the bundled docs (NOT the public Next.js site):

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/`

The four v16 facts that bite you here:

1. **`context.params` is a `Promise`** — you MUST `await params`. The v15 sync shim is gone.
2. **GET route handlers are dynamic (uncached) by default.** Good for a fresh feed, but
   be explicit: `export const dynamic = 'force-dynamic'`.
3. **Read query strings via `request.nextUrl.searchParams`** (a `NextRequest`).
4. **Mongoose needs the Node runtime**: `export const runtime = 'nodejs'` (it uses the
   native TCP driver, not Edge-compatible).

Cross-reference: the **database** skill (connection, model fields, indexes, `.lean()`,
fingerprint upsert) and the **scheduling** skill (what calls `POST /api/refresh`).

## Repo wiring (real paths)

- `database/mongodb.ts` — default export `connectDB()`, cached global connection,
  `bufferCommands:false`, reads `process.env.MONGODB_URI`.
- `database/index.ts` — barrel: `import { Event, type IEvent } from '@/database'`.
- `database/event.model.ts` — `Event` model. **Canonical fields** (use these EXACT names,
  do not invent): `title, slug, description, overview, image, venue, country, city,
  date` (String `YYYY-MM-DD`), `time` (String `HH:MM` 24h), `mode` (`online|offline|hybrid`),
  `audience, agenda` (String[]), `organizer, tags` (String[]), `createdAt, updatedAt`.
  Aggregator extensions added per the database skill: `url, source, fingerprint, timezone,
  category, eventType, isFree, price` (filters below tolerate them being absent).

**The contract:** `await connectDB()` is the FIRST awaited line in every handler. With
`bufferCommands:false`, a query issued before the connection is live fails immediately
instead of buffering — so connect first, always.

## GET /api/events — filter + search + pagination

File: `app/api/events/route.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import type { FilterQuery } from 'mongoose';
import connectDB from '@/database/mongodb';
import { Event, type IEvent } from '@/database';

export const runtime = 'nodejs';        // Mongoose can't run on Edge
export const dynamic = 'force-dynamic';  // feed must never be stale

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request: NextRequest) {
  await connectDB();
  const sp = request.nextUrl.searchParams;

  const filter: FilterQuery<IEvent> = {};

  // mode (enum) — validate against the schema's allowed values
  const mode = sp.get('mode');
  if (mode && ['online', 'offline', 'hybrid'].includes(mode)) {
    filter.mode = mode;
  }

  // city — case-insensitive exact match (anchored so a city index can still help)
  const city = sp.get('city');
  if (city) filter.city = { $regex: `^${escapeRegex(city)}$`, $options: 'i' };

  // category / eventType / tags — accept any, map onto indexed fields
  const category = sp.get('category');
  if (category) filter.category = category;
  const eventType = sp.get('type');
  if (eventType) filter.eventType = eventType;
  const tags = sp.getAll('tag').filter(Boolean);
  if (tags.length) filter.tags = { $in: tags };

  // date range — date is a fixed-width YYYY-MM-DD string, so a lexical
  // $gte/$lte range IS the chronological range. No Date conversion needed.
  const from = sp.get('from'); // e.g. 2026-06-08
  const to = sp.get('to');
  if (from || to) {
    filter.date = {};
    if (from) (filter.date as Record<string, string>).$gte = from;
    if (to) (filter.date as Record<string, string>).$lte = to;
  }

  // free / paid — only meaningful once isFree exists; no-op otherwise
  const price = sp.get('price');
  if (price === 'free') filter.isFree = true;
  if (price === 'paid') filter.isFree = false;

  // keyword — requires the text index (see "Search" below)
  const q = sp.get('q')?.trim();
  if (q) filter.$text = { $search: q };

  // pagination — clamp untrusted input
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 20, 1), 100);
  const page = Math.max(Number(sp.get('page')) || 1, 1);
  const skip = (page - 1) * limit;

  const sort = q
    ? { score: { $meta: 'textScore' as const } } // relevance for keyword search
    : { date: 1 as const, _id: 1 as const };      // chronological, deterministic

  const [items, total] = await Promise.all([
    Event.find(filter, q ? { score: { $meta: 'textScore' } } : {})
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),                 // POJOs — big perf win on list reads
    Event.countDocuments(filter),
  ]);

  return NextResponse.json({
    items,
    page,
    limit,
    total,
    hasMore: skip + items.length < total,
  });
}
```

**Why `.lean()`:** returns plain objects (no Mongoose hydration), faster and serializes
straight to JSON. Use it on every read that doesn't need document methods.

**Search note:** `$text` needs a text index on the model (defined in the database skill:
`{ title: 'text', description: 'text', tags: 'text' }`). Without it, `$text` errors. You
cannot `_id`-cursor-paginate and sort by `textScore` at once — keyword search uses
skip/limit; the plain feed can graduate to cursor pagination (see database skill).

Example: `GET /api/events?mode=offline&city=Toronto&category=hackathon&from=2026-06-08&q=ai&page=2&limit=20`

## GET /api/events/[slug] — single event

File: `app/api/events/[slug]/route.ts`. **`params` is a Promise — await it.**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import connectDB from '@/database/mongodb';
import { Event } from '@/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  await connectDB();
  const { slug } = await params;            // MUST await in v16

  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
  }

  const event = await Event.findOne({ slug: slug.toLowerCase() }).lean();
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  return NextResponse.json({ event });
}
```

`slug` is unique and stored lowercase (schema has `lowercase: true`), so lowercase the
lookup. The globally-available `RouteContext<'/api/events/[slug]'>` helper can replace the
inline `params` type once `next typegen`/`next dev` has generated types.

## POST /api/refresh — cron trigger guarded by CRON_SECRET

File: `app/api/refresh/route.ts`. Called by the scheduler (see scheduling skill), not by
the browser. Auth via a bearer token in the `Authorization` header compared to the
server-only `CRON_SECRET` (no `NEXT_PUBLIC_` prefix — never exposed to the client).

```ts
import { NextResponse, type NextRequest } from 'next/server';
import connectDB from '@/database/mongodb';
import { runScrape } from '@/lib/scrape'; // implemented per the scraping/database skills

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';   // never cache a mutation endpoint
export const maxDuration = 300;           // scrapes are slow; raise the function ceiling

export async function POST(request: NextRequest) {
  // 1. Auth — constant-shape check, fail closed if the secret is unset
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Optional body to scope the run, e.g. { sources: ["luma","eventbrite"] }
  let sources: string[] | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body?.sources)) sources = body.sources.map(String);
  } catch {
    /* empty/invalid body is fine — refresh everything */
  }

  // 3. Connect, then run the upsert-on-fingerprint scrape (see database skill)
  await connectDB();
  const result = await runScrape({ sources });

  return NextResponse.json({
    ok: true,
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
    ranAt: new Date().toISOString(),
  });
}
```

Caller (scheduler / manual trigger) sends:

```
POST /api/refresh
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json

{ "sources": ["luma", "eventbrite", "meetup"] }
```

Rules:

- **POST, not GET** — it mutates. GET should be safe/idempotent and is the cached default.
- Read `CRON_SECRET` inside the handler (`process.env`), never with a `NEXT_PUBLIC_` prefix.
- **Fail closed:** if `CRON_SECRET` is unset, return 401 — don't run unauthenticated.
- The actual scrape (Apify actors, normalize, `bulkWrite` upsert on `fingerprint`) lives in
  `lib/` per the database + scraping skills; this handler only authenticates and delegates.

## Validation & response conventions

- Clamp/whitelist every query input: `limit` clamped to 1..100, `mode` checked against the
  enum, `price` against `free|paid`. Never pass raw `searchParams` straight into a query.
- Escape user strings used in `$regex` (see `escapeRegex`) to avoid ReDoS / regex injection.
- Status codes: `200` ok, `400` bad input, `401` bad/absent cron secret, `404` no event,
  `405` is automatic for undefined methods (don't hand-roll it).
- Always `return NextResponse.json(...)` (or `Response.json(...)`); set status via the
  second arg. To set headers you must return a new `Response` — the `headers()` instance
  from `next/headers` is read-only.

## Gotchas

- Forgetting `await params` in `[slug]` — in v16 `params` is a Promise; the sync shim was
  removed, so omitting `await` yields a Promise, not the string.
- Forgetting `export const runtime = 'nodejs'` — Mongoose fails on the Edge runtime.
- Omitting `dynamic = 'force-dynamic'` and getting a stale feed if the route is ever
  prerendered. The feed and the refresh endpoint must both be dynamic.
- `date` comparisons rely on the `YYYY-MM-DD` zero-padded format — only correct because
  the pre-save hook normalizes it. Don't feed unnormalized date strings into the range.
