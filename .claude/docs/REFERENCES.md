# REFERENCES — Tech Event Aggregator (Northbound)

A curated link index for this project. Use these instead of guessing package names,
commands, or APIs from memory. URLs here are verified.

> **Authoritative Next.js reference is LOCAL, not the website.** This repo runs a
> heavily modified **Next.js 16.2.6** whose APIs differ from upstream/training data.
> For ANY Next.js code (route handlers, data fetching, config, `dynamic`, metadata),
> read the bundled docs first:
>
> ```
> node_modules/next/dist/docs/01-app/
> ```
>
> The links to nextjs.org below are convenience/secondary — when they conflict with
> the bundled docs, the bundled docs win.

Versions below are pinned from `package.json` (verified). Confirm with:

```bash
cat /home/praeplas4/Documents/next_fullstack/events_site/package.json
cat /home/praeplas4/Documents/next_fullstack/events_site/node_modules/next/package.json
```

---

## Framework & UI

| What | Version (this repo) | Docs / Repo |
|---|---|---|
| Next.js | `16.2.6` | **Bundled (authoritative):** `node_modules/next/dist/docs/01-app/` · Site: https://nextjs.org/docs · Repo: https://github.com/vercel/next.js |
| React | `19.2.4` | https://react.dev · https://react.dev/blog/2024/12/05/react-19 · Repo: https://github.com/facebook/react |
| Tailwind CSS | v4 (`tailwindcss@^4`, `@tailwindcss/postcss@^4`) | https://tailwindcss.com/docs · v4 guide: https://tailwindcss.com/blog/tailwindcss-v4 · Repo: https://github.com/tailwindlabs/tailwindcss |
| shadcn (CLI) | `^4.7.0` | https://ui.shadcn.com/docs · https://ui.shadcn.com/docs/cli · Repo: https://github.com/shadcn-ui/ui |
| radix-ui | `^1.4.3` | https://www.radix-ui.com/primitives/docs/overview/introduction · Repo: https://github.com/radix-ui/primitives |
| lucide-react | `^1.14.0` | https://lucide.dev/icons · https://lucide.dev/guide/packages/lucide-react · Repo: https://github.com/lucide-icons/lucide |
| ogl (LightRays bg) | `^1.0.11` | Repo: https://github.com/oframe/ogl |

Most-used bundled Next.js doc paths (all under `node_modules/next/dist/docs/01-app/`):

```
03-api-reference/03-file-conventions/route.md      # Route Handlers (app/api/.../route.ts)
01-getting-started/15-route-handlers.md            # GET not cached by default in v16
01-getting-started/06-fetching-data.md             # fetch() not cached by default
03-api-reference/04-functions/fetch.md             # fetch caching/revalidate/tags
03-api-reference/03-file-conventions/page.md       # async params & searchParams
02-guides/upgrading/version-16.md                  # breaking changes (READ THIS)
02-guides/caching-without-cache-components.md       # unstable_cache / segment config
```

---

## Database — MongoDB + Mongoose (FINAL: not Postgres, not Supabase, not Prisma)

| What | Version (this repo) | Docs / Repo |
|---|---|---|
| Mongoose | `9.6.2` | https://mongoosejs.com/docs/ · API: https://mongoosejs.com/docs/api/mongoose.html · Repo: https://github.com/Automattic/mongoose |
| MongoDB Node driver | `7.2.0` | https://www.mongodb.com/docs/drivers/node/current/ · Repo: https://github.com/mongodb/node-mongodb-native |
| MongoDB / Atlas | — | https://www.mongodb.com/docs/manual/ · Atlas: https://www.mongodb.com/docs/atlas/ · Atlas Search: https://www.mongodb.com/docs/atlas/atlas-search/ |

Existing DB code in this repo (do not contradict):

```
database/mongodb.ts          # default export connectDB() — cached global, bufferCommands:false, MONGODB_URI
database/event.model.ts      # Event model
database/booking.model.ts    # Booking model
database/index.ts            # barrel: Event, Booking, IEvent, IBooking
```

Reference: `.claude/docs/` Mongoose patterns (cached connection, idempotent
`fingerprint` upsert, `bulkWrite({ ordered:false })`, E11000 handling, `$text` vs
Atlas `$search`, ESR indexes).

---

## MCP servers

The repo's server set lives in `.mcp.json` at the repo root. Reference table:

| Server | Package / Repo | Notes |
|---|---|---|
| **mongodb** (required) | `mongodb-mcp-server` — https://github.com/mongodb-js/mongodb-mcp-server | Schema/query/migration. Env `MDB_MCP_CONNECTION_STRING`. `--readOnly` recommended. |
| **apify** (optional) | `@apify/actors-mcp-server` — https://github.com/apify/apify-mcp-server | Runs event-scraping actors. Env `APIFY_TOKEN`. Hosted alt: https://mcp.apify.com |
| **playwright** (recommended) | `@playwright/mcp` — https://github.com/microsoft/playwright-mcp | JS-heavy company pages. No key. |
| **fetch** (optional) | `mcp-server-fetch` (Python via `uvx`) — https://github.com/modelcontextprotocol/servers/tree/main/src/fetch | Static pages → markdown. No key. |
| **brave-search** (optional) | `@brave/brave-search-mcp-server` — https://github.com/brave/brave-search-mcp-server | URL discovery. Env `BRAVE_API_KEY`. Replaces deprecated `@modelcontextprotocol/server-brave-search`. |

Launch commands (verified):

```bash
# mongodb — needs your own Atlas/Mongo connection string (no paid key required)
npx -y mongodb-mcp-server@latest --readOnly

# apify — token from console.apify.com → Settings → API & Integrations
npx -y @apify/actors-mcp-server --tools actors,docs

# playwright — first run downloads browser binaries
npx -y @playwright/mcp@latest --headless --isolated

# fetch — Python server; requires `uv` installed (NOT an npm package)
uvx mcp-server-fetch

# brave-search — v2.x default transport is stdio; pass it explicitly
npx -y @brave/brave-search-mcp-server --transport stdio
```

Get keys: Apify → https://console.apify.com (Settings → API & Integrations) ·
Brave → https://api-dashboard.search.brave.com/app/keys (free tier ~2,000 queries/mo).

---

## Apify actors (event scraping)

| Platform | Actor | Page |
|---|---|---|
| Luma city pages (e.g. `lu.ma/toronto` → slug `toronto`) | `mhamas/luma-calendar-events-scraper` | https://apify.com/mhamas/luma-calendar-events-scraper |
| Luma keyword/search | `lexis-solutions/lu-ma-scraper` ($29/mo rental) | https://apify.com/lexis-solutions/lu-ma-scraper |
| Eventbrite | `parseforge/eventbrite-scraper` (~$4/1k) | https://apify.com/parseforge/eventbrite-scraper |
| Meetup | `easyapi/meetup-events-scraper` (~$4.99/1k) | https://apify.com/easyapi/meetup-events-scraper |

Apify REST API docs (actor ID in URLs is `username~actor-name`, tilde-separated):

```
Run sync + get items : https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post
Start run (async)    : https://docs.apify.com/api/v2/act-runs-post
Get run status       : https://docs.apify.com/api/v2/actor-run-get
Get dataset items    : https://docs.apify.com/api/v2/dataset-items-get
Getting started/auth : https://docs.apify.com/api/v2/getting-started
```

Auth: send `Authorization: Bearer <APIFY_TOKEN>` (read from `process.env.APIFY_TOKEN`;
do NOT use the `?token=` query param — it leaks into logs). Always set a small
`maxItems`/`maxEvents` (3–10) while developing to protect the ~$5/mo free credit.

---

## Calendar export — add-to-calendar-button(-react)

| What | Version | Docs / Repo |
|---|---|---|
| add-to-calendar-button-react | `2.14.0` (latest) | npm: https://www.npmjs.com/package/add-to-calendar-button-react |
| add-to-calendar-button (core) | `2.x` (peer dep, auto-installed) | Repo: https://github.com/add2cal/add-to-calendar-button |

Docs: configuration https://add-to-calendar-button.com/configuration ·
use with React https://add-to-calendar-button.com/use-with-react

```bash
npm install add-to-calendar-button-react
```

```jsx
'use client';
import { AddToCalendarButton } from 'add-to-calendar-button-react'; // named export
```

Field mapping (PROJECT CANON): `Event.date` → `startDate` (`YYYY-MM-DD`),
`Event.time` → `startTime` (`HH:MM` 24h), `Event.timezone` → `timeZone` (IANA).
Client-only Web Component — if you hit hydration errors, dynamic-import with
`{ ssr: false }` **inside** a `'use client'` file (verify `dynamic` semantics against
`node_modules/next/dist/docs/01-app/` first, since this is a modified Next.js).

---

## Analytics — PostHog

| What | Version (this repo) | Docs / Repo |
|---|---|---|
| posthog-js | `^1.374.3` | https://posthog.com/docs/libraries/js · Next.js: https://posthog.com/docs/libraries/next-js · Repo: https://github.com/PostHog/posthog-js |

Already wired in this repo via `instrumentation-client.ts` and the `/ingest` reverse
proxy in `next.config.ts`. Existing event names (keep them):
`explore_events_clicked`, `event_card_clicked`. Add new `capture()` calls as features land.

---

## GTA event source URLs

Canonical sources to scrape / discover events from (Greater Toronto Area focus):

```
Luma (Toronto)   https://lu.ma/toronto          # calendar slug = "toronto"
MLH seasons      https://mlh.io/seasons          # hackathons
GDG community    https://gdg.community.dev
AWS events       https://aws.amazon.com/events/
Communitech      https://communitech.ca/events/
MaRS DD          https://www.marsdd.com/events/
Hackathons CA    https://hackathons.ca
```

Also referenced as sources in the product: Eventbrite (https://www.eventbrite.ca),
Meetup (https://www.meetup.com), RBC, Databricks (https://www.databricks.com/events).

---

## Secrets (server-only — never `NEXT_PUBLIC_`)

```
MONGODB_URI     # database/mongodb.ts
APIFY_TOKEN     # Apify REST + MCP
CRON_SECRET     # protect the scrape/refresh route
BRAVE_API_KEY   # brave-search MCP
```

The MongoDB MCP server reads `MDB_MCP_CONNECTION_STRING` (separate from app's `MONGODB_URI`).

---

## Project knowledge docs (this repo)

```
.claude/docs/CONTEXT.md       # what/why of the project
.claude/docs/decisions.md     # locked decisions (MongoDB, MCP set, etc.)
.claude/docs/gotchas.md       # traps (Next.js 16 async APIs, bulk-op hooks, SSR)
.claude/docs/REFERENCES.md    # this file
.claude/skills/README.md      # skills index
.mcp.json                     # MCP server config (repo root)
AGENTS.md / CLAUDE.md         # agent instructions (repo root)
```
