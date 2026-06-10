# CONTEXT — Tech Event Aggregator (DevEvents)

> **Read this file first.** It is the project state snapshot every agent loads before
> acting. It records the verified stack, what is already built, what is not built yet,
> the agent roles, and how to navigate the repo. When you make a decision, log it in
> `.claude/docs/decisions.md`; log blockers/non-obvious behavior in
> `.claude/docs/gotchas.md`; record source links in `.claude/docs/REFERENCES.md`.

---

## 1. Purpose

DevEvents scrapes upcoming **tech / AI / data developer and networking events plus
hackathons** from **Luma, Eventbrite, Meetup, and company sites** (RBC, Google/GDG, AWS,
Databricks, MLH), **normalizes** them into one unified feed, and lets users
**filter/search** and **add events to Google / Outlook / Apple / Yahoo / iCal calendars**.

**Focus region: the Greater Toronto Area (GTA).**

Pipeline: `scheduler → scraper → normalizer (dedup) → MongoDB → API → feed UI → calendar`.

---

## 2. Verified stack (from `package.json`)

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router) | **16.2.6** |
| UI runtime | React / React DOM | **19.2.4** |
| Language | TypeScript | 5 |
| Styling | Tailwind | v4 (`@tailwindcss/postcss`) |
| Components | shadcn + `radix-ui` | shadcn 4.7.0 / radix 1.4.3 |
| Icons | `lucide-react` | 1.14.0 |
| Background FX | `ogl` (LightRays WebGL) | 1.0.11 |
| Analytics | `posthog-js` | 1.374.3 |
| Database driver | `mongoose` / `mongodb` | **9.6.2 / 7.2.0** |

> **CRITICAL — this is a heavily modified Next.js 16.** Its request-time APIs differ from
> older training data. The bundled docs at `node_modules/next/dist/docs/01-app` are the
> **source of truth** for any Next.js code. Read them *before* writing route handlers,
> data fetching, or config. Key v16 facts that bite:
> - `params` and `searchParams` are **Promises** — `await` them.
> - `GET` route handlers and `fetch()` are **NOT cached by default** (dynamic).
> - Mongoose needs `export const runtime = 'nodejs'` (native TCP driver, not Edge).
> - `middleware` was renamed to `proxy`; `next lint` was removed.

### Database decision (FINAL): **MongoDB + Mongoose**
NOT Supabase, NOT Postgres, NOT Prisma. Working Mongoose models already exist; the
document model fits heterogeneous multi-source scraped data; upsert-on-`fingerprint`
makes dedup trivial; pre-save hooks already normalize slug/date/time; Atlas free tier +
Atlas Search cover hosting and full-text. (`AGENTS.md` still mentions Supabase in places —
that is stale; **MongoDB is authoritative**.)

---

## 3. What is ALREADY built

### Database layer (`database/`) — fully working
- **`database/mongodb.ts`** — default-export `connectDB()` with a cached global Mongoose
  connection (`global.mongoose`), `bufferCommands: false`, `maxPoolSize: 10`,
  `serverSelectionTimeoutMS: 10000`, reads `process.env.MONGODB_URI`.
  Always `await connectDB()` as the first line of any handler/action.
- **`database/event.model.ts`** — the `Event` model + `IEvent` interface, **including the
  §6 aggregator extensions** (`url`, `source`, `sourceId`, `fingerprint`, `timezone`,
  `endDate`/`endTime`, `isFree`, `price`, `category`; `overview`/`audience`/`agenda` now
  optional). Pre-save hook generates `slug`, normalizes `date`→`YYYY-MM-DD` and
  `time`→`HH:MM`; exports `generateSlug()` for the bulkWrite path. Indexes: `{slug} unique`,
  `{fingerprint} unique sparse`, `{mode,date}`, `{city,date}`, `{tags,date}`, `{date,_id}`,
  and a text index on `title/description/tags`. *(`fingerprint` is NOT `required` — the
  scraper upsert path always sets it; hand-entered docs may omit it, hence sparse.)*
- **`database/normalize.ts`** — `normalizeRawEvent(raw, source)` + `normalizeDate`/
  `normalizeTime` (per the data-schema skill).
- **`database/fingerprint.ts`** — `buildFingerprint()`: sha256(title|date|city).
- **`database/booking.model.ts`** — `Booking` model + `IBooking`. Pre-save hook checks the
  referenced Event exists. Indexes: `eventId`, `{ eventId, createdAt: -1 }`, `email`, and
  unique `{ eventId, email }` (one booking per email per event).
- **`database/index.ts`** — barrel exporting `Event`, `Booking`, `IEvent`, `IBooking`.

**Current `Event` fields (EXACT — do not invent different names):**
`title` (max 100) · `slug` (unique, auto from title) · `description` (max 1000) ·
`overview?` (max 500) · `image` · `venue` · `country` · `city` ·
`date` (String `YYYY-MM-DD`) · `time` (String `HH:MM` 24h) · `endDate?` · `endTime?` ·
`timezone` (IANA, default `America/Toronto`) ·
`mode` (enum `online | offline | hybrid`) · `audience?` · `agenda?` (String[]) ·
`organizer` · `tags` (String[]) · `url` · `source` (enum
`luma|eventbrite|meetup|mlh|company`) · `sourceId?` · `fingerprint?` (unique sparse) ·
`isFree?` · `price?` · `category?` (enum `hackathon|meetup|conference|networking`) ·
`createdAt` / `updatedAt`.

**Current `Booking` fields:** `eventId` (ObjectId ref `Event`) · `email`
(validated, lowercased) · `createdAt` / `updatedAt`.

### Analytics — wired
- **`instrumentation-client.ts`** — `posthog.init(...)` with `api_host: "/ingest"`,
  `ui_host: "https://us.posthog.com"`, `defaults: '2026-01-30'`, exception capture on.
  Token: `process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`.
- **`next.config.ts`** — reverse-proxy rewrites for `/ingest/...` → PostHog, plus
  `skipTrailingSlashRedirect: true`.
- Events already captured: **`explore_events_clicked`** (ExploreBtn) and
  **`event_card_clicked`** (EventCard). Keep these names; add new `capture()` calls as
  features land.

### Frontend — landing page only
- **`app/layout.tsx`** — root layout; renders `Navbar`, a full-screen `LightRays` WebGL
  background, Google fonts (Schibsted Grotesk + Martian Mono), and `metadata`.
- **`app/page.tsx`** — landing page: hero copy, `ExploreBtn`, and a "Featured Events" grid
  mapping **hard-coded** `events` from `lib/constants.ts` into `EventCard`.
- **`components/EventCard.tsx`** — `'use client'` card; links to `/events/${slug}`, fires
  `event_card_clicked`. Props use the canonical `organizer` field.
- **`components/ExploreBtn.tsx`** — `'use client'`; scrolls to `#events`, fires
  `explore_events_clicked`.
- **`components/Navbar.tsx`**, **`components/LightRays.tsx`** (+ `LightRays.css`) — present.
- **`lib/constants.ts`** — placeholder `events` array (GTA samples). **Temporary** — will be
  replaced by live data from `GET /api/events`.
- **`lib/utils.ts`** — `cn()` helper (clsx + tailwind-merge).

### API layer (`app/api/`) — built and live-tested
All routes: `export const runtime = 'nodejs'`, `dynamic = 'force-dynamic'`,
`await connectDB()` first, `.lean()` reads.
- **`GET /api/events`** — filter (`mode`, `city`, `category`/`type`, `source`, `tag`
  multi, `from`/`to` date range, `price=free|paid`), keyword `q` ($text), pagination
  (`page`, `limit` clamped 1..100). Returns `{ items, page, limit, total, hasMore }`.
- **`GET /api/events/[slug]`** — single event, 404 when absent. (`await params` — v16.)
- **`POST /api/bookings`** — `{ eventId, email }` → 201; 409 on duplicate (unique
  `{eventId,email}` index); 400 on bad input.
- **`POST /api/refresh`** — `Authorization: Bearer <CRON_SECRET>` (fail-closed 401),
  optional `{ sources: [...] }` body, delegates to `runScrape()` in **`lib/scrape.ts`**
  (normalize → fingerprint → `bulkWrite` upsert, E11000-tolerant). The per-source
  `FETCHERS` registry is **empty until the scraper milestone** — refresh is a no-op.

### Agent tooling — present
- **`.mcp.json`** (repo root) — the five MCP servers from §5 (`mongodb`, `apify`,
  `playwright`, `fetch`, `brave-search`), secrets via `${VAR}` interpolation.
- **`.env.example`** — committed secrets template; copy to `.env.local` (gitignored).

---

## 4. What is NOT built yet

Nothing below exists in the repo — these are the work items.

- **Scrapers** — the `FETCHERS` registry in `lib/scrape.ts` is empty: no Apify/Playwright
  fetchers implemented yet. Everything downstream (normalize → fingerprint → upsert →
  API) is already wired and waiting for them.
- **Events feed UI** — no `/events` route, no filter/search UI; the landing grid is static.
- **Add-to-calendar button** — `add-to-calendar-button-react` is not installed; no
  calendar component.
- **Scheduler** — no cron config to run the scraper nightly.

---

## 5. MCP servers (decided set)

Config lives in **`.mcp.json`** at the repo root (present). Secrets are referenced
as `${VAR}` env interpolation, never hardcoded (template: `.env.example`, also present).

| Server | Command | Env | Role |
|---|---|---|---|
| **mongodb** | `npx -y mongodb-mcp-server@latest --readOnly` | `MDB_MCP_CONNECTION_STRING` | Schema/query against Atlas. Required. Drop `--readOnly` to allow writes/migrations. |
| **apify** | `npx -y @apify/actors-mcp-server --tools actors,docs` | `APIFY_TOKEN` | Runs Luma/Eventbrite/Meetup scraping actors. |
| **playwright** | `npx -y @playwright/mcp@latest --headless --isolated` | — | JS-heavy company pages. |
| **fetch** | `uvx mcp-server-fetch` | — | Static pages → markdown (Python, via `uvx`). Optional. |
| **brave-search** | `npx -y @brave/brave-search-mcp-server --transport stdio` | `BRAVE_API_KEY` | Discover event URLs. Optional. |

**No `supabase` server.** See PROJECT CANON / RESEARCH for full per-server notes and the
ready-to-paste `.mcp.json`.

---

## 6. Aggregator schema extensions — **APPLIED** (kept as the spec of record)

Applied to `database/event.model.ts`. Scraped-optional fields are optional.

```ts
// ADD to IEvent + EventSchema
url:        string;   // canonical source event URL — REQUIRED for this product
source:     string;   // 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company'
sourceId?:  string;   // platform-native id
fingerprint: string;  // dedup key — unique sparse index
timezone:   string;   // IANA, default 'America/Toronto' (needed for calendar export)
endDate?:   string;   // YYYY-MM-DD (optional)
endTime?:   string;   // HH:MM (optional)
isFree?:    boolean;  // free vs paid filter
price?:     string;
category?:  string;   // 'hackathon' | 'meetup' | 'conference' | 'networking'

// RELAX requireds scraped sources often lack:
//   overview, agenda, audience  → make optional for scraped events.

// INDEXES (add):
EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });
// also recommended (replace {date:1,mode:1}): {mode:1,date:1}, {city:1,date:1},
// {tags:1,date:1}, {date:1,_id:1}, and one text index on title/description/tags.
```

**Dedup fingerprint (decided):**
```
fingerprint = sha256( lower(trim(title)) + '|' + date(YYYY-MM-DD) + '|' + lower(city) )
```
Exclude `time` (sources disagree by minutes). Upsert with
`Event.updateOne({fingerprint}, {$set:{...}, $setOnInsert:{...}}, {upsert:true})` or
`bulkWrite([...], {ordered:false})` for batches. **Pre-save hooks do NOT run on
`updateOne`/`bulkWrite`** — normalize `date`/`time`/`slug` in the scraper before upserting.
Treat `code === 11000` (duplicate key) as a benign dedup race.

---

## 7. Calendar export (decided approach)

Install `add-to-calendar-button-react` and use it inside a `'use client'` component
(it is a Web Component — client-only). Map model → props:
`Event.date → startDate (YYYY-MM-DD)`, `Event.time → startTime (HH:MM)`,
`Event.timezone → timeZone (IANA)`. Supports Google/Outlook/Apple/Yahoo/iCal with no
backend or OAuth. If hydration errors appear, load via
`next/dynamic(..., { ssr: false })` from inside the client component.

---

## 8. Agent roles (from `AGENTS.md`)

| Agent | Responsibility | Skills |
|---|---|---|
| **scraper-agent** | Extract raw events from Luma/Eventbrite/Meetup (+ company pages) via Apify actors or Playwright. | `scraping`, `apify-actors` |
| **normalizer-agent** | Map raw JSON → canonical `Event`, dedup across platforms, upsert to MongoDB. | `data-schema`, `deduplication` |
| **backend-agent** | REST API the frontend calls — `GET /events` (filter/date/city/keyword), `GET /events/:id`, refresh trigger. | `backend-api` |
| **frontend-agent** | Next.js UI — event grid with filters + Add-to-Calendar button. | `frontend`, `calendar-button` |
| **scheduler-agent** | Cron-trigger the scraper (nightly) + cache invalidation. | `scheduling` |

> `AGENTS.md` predates the DB decision and names Supabase/Hono in the role text. Ignore
> that: the stack is **Next.js App Router API routes + MongoDB/Mongoose**.

---

## 9. Repo navigation

```
events_site/
├── app/
│   ├── layout.tsx            # root layout: Navbar + LightRays + fonts + metadata
│   ├── page.tsx              # landing page (static featured grid)
│   ├── globals.css
│   └── api/                  # NOT YET — route handlers go here (route.ts per folder)
├── components/
│   ├── EventCard.tsx         # 'use client', fires event_card_clicked
│   ├── ExploreBtn.tsx        # 'use client', fires explore_events_clicked
│   ├── Navbar.tsx
│   └── LightRays.tsx (+ .css)
├── database/
│   ├── mongodb.ts            # connectDB() cached global connection
│   ├── event.model.ts        # Event model + IEvent + pre-save normalization
│   ├── booking.model.ts      # Booking model + IBooking
│   └── index.ts              # barrel: Event, Booking, IEvent, IBooking
├── lib/
│   ├── constants.ts          # placeholder events array (temporary)
│   └── utils.ts              # cn()
├── instrumentation-client.ts # PostHog init
├── next.config.ts            # /ingest PostHog proxy rewrites
├── .mcp.json                 # MCP server config (§5) — present
├── .env.example              # secrets template (copy to .env.local) — present
├── AGENTS.md / CLAUDE.md     # project instructions (root)
├── .claude/
│   ├── skills/<name>/SKILL.md   # invokable skills (+ skills/README.md index)
│   └── docs/                    # CONTEXT.md (this), decisions.md, gotchas.md, REFERENCES.md
└── node_modules/next/dist/docs/01-app/   # ★ Next.js 16 source of truth
```

**Import alias:** `@/*` → repo root (e.g. `import connectDB from '@/database/mongodb'`,
`import { Event, type IEvent } from '@/database'`).

---

## 10. Conventions

- TypeScript, App Router, **server components by default**; `'use client'` only when needed.
- API routes live at `app/api/<name>/route.ts`, export async `GET`/`POST`/etc.
  `await params`; read query via `request.nextUrl.searchParams`.
- Every route/action: `export const runtime = 'nodejs'` and `await connectDB()` first;
  use `.lean()` on read queries.
- **Secrets are server-only — no `NEXT_PUBLIC_` prefix:** `MONGODB_URI`, `APIFY_TOKEN`,
  `CRON_SECRET`, `BRAVE_API_KEY`, `MDB_MCP_CONNECTION_STRING`. (The PostHog *project
  token* is the one intentional public var.)
- For any Next.js API: read `node_modules/next/dist/docs/01-app` before coding — do not
  trust training-data Next.js behavior.
