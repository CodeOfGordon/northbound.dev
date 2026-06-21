# Skills Index — Tech Event Aggregator (Northbound)

Northbound scrapes upcoming tech / AI / data developer and networking events plus
hackathons from **Luma, Eventbrite, Meetup, and company sites (RBC, Google/GDG,
AWS, Databricks, MLH)**, normalizes them into one feed, and lets users
filter/search and add events to Google / Outlook / Apple calendars. Focus region:
the **Greater Toronto Area**.

Skills are focused reference files that give agents the exact patterns, code, and
constraints for a single task. **Always load the relevant SKILL(s) before writing
code.** Each skill lives at `.claude/skills/<name>/SKILL.md`.

> **Stack (verified from `package.json`):** Next.js **16.2.6** (App Router) ·
> React **19.2.4** · TypeScript 5 · Tailwind v4 · shadcn + radix-ui ·
> lucide-react · ogl (LightRays background) · posthog-js (analytics already wired
> via `instrumentation-client.ts` + the `/ingest` reverse proxy in
> `next.config.ts`).
>
> **Database (FINAL):** MongoDB + Mongoose. Existing code lives in `database/`
> (`mongodb.ts`, `event.model.ts`, `booking.model.ts`, `index.ts`). NOT Prisma.
>
> **CRITICAL — modified Next.js 16:** this is a heavily modified Next.js whose
> APIs differ from training data. The bundled docs at
> `node_modules/next/dist/docs/01-app` are the **source of truth** for any
> Next.js code (route handlers, data fetching, config). Read them first.

---

## Available Skills

| Skill (`.claude/skills/<name>/SKILL.md`) | When to Use |
|---|---|
| [`event-scraping/SKILL.md`](event-scraping/SKILL.md) | Orchestrating the end-to-end scrape: which sources/actors to run, mapping raw items per platform, the overall scrape → normalize → dedup → upsert pipeline. Start here for any scraping work. |
| [`apify-actors/SKILL.md`](apify-actors/SKILL.md) | Invoking Apify actors (Luma/Eventbrite/Meetup) via the Apify MCP server or REST. Actor selection, run + poll (`runs/last`), fetching dataset items, `APIFY_TOKEN` auth, free-tier `maxItems` budgeting. |
| [`data-schema/SKILL.md`](data-schema/SKILL.md) | Defining or extending the canonical `Event` type, and writing normalization functions that map raw scraped data into the Mongoose `Event` model. Required fields, `source`/`url`/`fingerprint` extensions, date/time/timezone normalization. |
| [`deduplication/SKILL.md`](deduplication/SKILL.md) | Deduplicating events seen on multiple sources. The `fingerprint` hash strategy and Mongo upsert-on-fingerprint via `updateOne` / `bulkWrite`. |
| [`calendar-button/SKILL.md`](calendar-button/SKILL.md) | Adding the "Add to Calendar" button (Google/Outlook/Apple/iCal). `add-to-calendar-button-react`, the `'use client'` wrapper, `startDate`/`startTime`/`timeZone` formats, and SSR/hydration gotchas. |
| [`backend-api/SKILL.md`](backend-api/SKILL.md) | Writing Next.js 16 route handlers: `GET /api/events` (filter/search), `GET /api/events/[slug]`, and `POST /api/refresh` (cron) with `CRON_SECRET` auth. Read the local Next 16 docs first. |
| [`database/SKILL.md`](database/SKILL.md) | Connecting to MongoDB/Mongoose, queries/upserts/aggregations, indexes, Atlas Search, and the MongoDB MCP server. The cached `connectDB()` pattern and the `Event`/`Booking` models. |
| [`frontend/SKILL.md`](frontend/SKILL.md) | Building the event grid, filter bar, search box, and event card. URL-based filter state via `searchParams`, and SWR client data fetching. |
| [`scheduling/SKILL.md`](scheduling/SKILL.md) | Scheduling the recurring scrape. The `POST /api/refresh` cron endpoint, `CRON_SECRET` verification, and the platform cron config that triggers it. |

> If a `SKILL.md` you reference does not yet exist, create the directory
> (`.claude/skills/<name>/SKILL.md`) — this index is the canonical list of 9.

---

## MCP Servers

Configured in **`.mcp.json`** at the repo root. Secrets are read from the
environment (server-only, **no `NEXT_PUBLIC_` prefix**). There is **NO Supabase
server** — the database is MongoDB.

| Server | Command | Env | Purpose | Status |
|---|---|---|---|---|
| **mongodb** | `npx -y mongodb-mcp-server@latest --readOnly` | `MDB_MCP_CONNECTION_STRING` | Schema / query / migration against MongoDB / Atlas. `--readOnly` disables create/update/delete (recommended); drop it to allow writes. Uses your own connection string (no paid key). | **Required** |
| **apify** | `npx -y @apify/actors-mcp-server --tools actors,docs` | `APIFY_TOKEN` | Runs Apify event-scraping actors. Token from console.apify.com → Settings → API & Integrations. Select tools with `--tools` (comma-separated). Hosted alternative: a `{"url":"https://mcp.apify.com?tools=actors,docs"}` server. | Optional* |
| **playwright** | `npx -y @playwright/mcp@latest --headless --isolated` | none | Headless browser for JS-heavy company pages (RBC/GDG/AWS/Databricks/MLH). `--headless` + `--isolated` (in-memory profile). First run downloads browser binaries. | Recommended |
| **fetch** | `uvx mcp-server-fetch` | none | Fetches a static URL → markdown. **Python** server via `uvx` (needs `uv`), NOT npm. | Optional |
| **brave-search** | `npx -y @brave/brave-search-mcp-server --transport stdio` | `BRAVE_API_KEY` | Discover event-page URLs. Current package is `@brave/brave-search-mcp-server` (replaces the deprecated `@modelcontextprotocol/server-brave-search`). Free tier ~2,000 queries/mo. | Optional |

\* Apify's token works on the free tier, but actually *running* most actors needs paid credits — keep `maxItems` small while developing.

`.mcp.json` (env vars are interpolated from the shell, never hard-coded):

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": { "MDB_MCP_CONNECTION_STRING": "${MDB_MCP_CONNECTION_STRING}" }
    },
    "apify": {
      "command": "npx",
      "args": ["-y", "@apify/actors-mcp-server", "--tools", "actors,docs"],
      "env": { "APIFY_TOKEN": "${APIFY_TOKEN}" }
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]
    },
    "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"],
      "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" }
    }
  }
}
```

**Server-only secrets:** `MONGODB_URI`, `APIFY_TOKEN`, `CRON_SECRET`,
`BRAVE_API_KEY`, `MDB_MCP_CONNECTION_STRING`.

---

## External Libraries

| npm Package | Version / Notes | Use Case | Skill |
|---|---|---|---|
| `add-to-calendar-button-react` | **v2.14.0**. Named export `AddToCalendarButton` (not default). Peer deps `react >=18` — fine on React 19. Web Component under the hood → must be client-only. | Calendar export button (Google/Outlook/Apple/iCal/Yahoo) | [`calendar-button/SKILL.md`](calendar-button/SKILL.md) |
| `mongoose` | **v9.6.2** (mongodb driver 7.2.0). Cached global `connectDB()` with `bufferCommands:false`; needs `export const runtime = 'nodejs'` (not Edge). | DB client, models, upserts, indexes, `$text` search | [`database/SKILL.md`](database/SKILL.md) · [`data-schema/SKILL.md`](data-schema/SKILL.md) |
| `swr` | Client-side fetching/caching for the event grid & filters. | Live filtering/search on the client | [`frontend/SKILL.md`](frontend/SKILL.md) |
| `next` | **v16.2.6** App Router. Request-time APIs are **async** (`await params`/`searchParams`); `GET` handlers + `fetch` are **uncached by default**. Docs: `node_modules/next/dist/docs/01-app`. | Framework (routes, pages, config) | [`backend-api/SKILL.md`](backend-api/SKILL.md) · [`frontend/SKILL.md`](frontend/SKILL.md) |
| `add-to-calendar-button-react` install | `npm install add-to-calendar-button-react` (core package comes as a dependency). | — | — |

---

## Canonical `Event` model (align EXACTLY)

Defined in `database/event.model.ts`; exported via `database/index.ts`
(`Event`, `Booking`, `IEvent`, `IBooking`). **Do not invent different field
names.**

**Existing fields:** `title` (max 100) · `slug` (unique, auto-generated from
`title` in a `pre('save')` hook) · `description` (max 1000) · `overview`
(max 500) · `image` · `venue` · `country` · `city` · `date` (**String**,
normalized `YYYY-MM-DD`) · `time` (**String**, normalized `HH:MM` 24h) · `mode`
(enum `online | offline | hybrid`) · `audience` · `agenda` (`String[]`) ·
`organizer` · `tags` (`String[]`) · timestamps `createdAt`/`updatedAt`.
Indexes: `slug` unique; compound `{ date: 1, mode: 1 }`.

**Aggregator extensions** (propose as a *diff* in `data-schema/SKILL.md`, don't
silently rewrite the file): `url` (canonical source link — **REQUIRED** for this
product) · `source` (`luma | eventbrite | meetup | mlh | company`) · `sourceId` ·
`fingerprint` (dedup key, unique **sparse** index) · `timezone` (IANA, default
`America/Toronto`) · `endDate`/`endTime` (optional) · `isFree`/`price` ·
`category`/`eventType` (`hackathon | meetup | conference | networking`). Relax
`overview`/`agenda`/`audience` to optional — scraped sources often omit them.

**Dedup:** `fingerprint = sha256(lower(trim(title)) + "|" + date(YYYY-MM-DD) +
"|" + lower(city))` — **excludes time** (sources disagree by minutes). Upsert via
`Event.updateOne({fingerprint}, {$set:{...}, $setOnInsert:{...}}, {upsert:true})`
or `bulkWrite` for batches. See [`deduplication/SKILL.md`](deduplication/SKILL.md).

**Booking model** (`database/booking.model.ts`): `eventId` (ObjectId ref
`Event`) · `email` (validated, lowercase) · timestamps. Unique compound index
`{ eventId, email }` (one booking per email per event).

**Analytics:** PostHog events already defined — `explore_events_clicked`,
`event_card_clicked`. Keep these names; add new `capture()` calls as features
land.

---

## Loading Order by Task

| Task | Load in order |
|---|---|
| **Scrape events from Luma / Eventbrite / Meetup** | `event-scraping` → `apify-actors` → `data-schema` → `deduplication` → `database` |
| **Scrape a JS-heavy company page (RBC/GDG/AWS/Databricks/MLH)** | `event-scraping` (use the **playwright** MCP) → `data-schema` → `deduplication` → `database` |
| **Define / migrate the Event schema** | `data-schema` → `database` |
| **Deduplicate / upsert scraped events** | `deduplication` → `database` |
| **Build the events API (`GET /api/events`)** | `backend-api` → `database` (read `node_modules/next/dist/docs/01-app` first) |
| **Build a single event page (`GET /api/events/[slug]`)** | `backend-api` → `database` |
| **Wire up the scheduled scrape (`POST /api/refresh` cron)** | `scheduling` → `backend-api` → `database` |
| **Build the event grid / filter bar / search** | `frontend` → `backend-api` |
| **Build the event card** | `frontend` → `calendar-button` |
| **Add the "Add to Calendar" button** | `calendar-button` (`'use client'`; map `date→startDate`, `time→startTime`, `timezone→timeZone`) |

---

### House rules (apply everywhere)

- **Next.js 16:** `await` `params`/`searchParams`; read query via
  `request.nextUrl.searchParams`. `GET` handlers are dynamic by default — add
  `export const dynamic = 'force-static'` / `revalidate` only to opt into caching.
  Mongoose routes need `export const runtime = 'nodejs'`.
- **DB access:** `await connectDB()` as the **first line** of every route handler
  / server action; use `.lean()` on list reads. Bulk ops (`updateOne`/
  `bulkWrite`) do **NOT** fire `pre('save')` hooks — normalize date/time/slug in
  the scraper before upserting.
- **TypeScript, App Router, server components by default;** API routes at
  `app/api/.../route.ts`. Secrets are server-only (no `NEXT_PUBLIC_`).
- Knowledge docs live in `.claude/docs/{CONTEXT,decisions,gotchas,REFERENCES}.md`.
