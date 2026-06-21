# Northbound

One clean feed of **official dev events from big tech & AI companies** (Google, AWS,
Microsoft Reactor, NVIDIA, Y Combinator, Tesla, Databricks, Snowflake, Figma, plus
Luma calendars for DeepMind, Modal, Cursor, LangChain, Cloudflare, Cohere and more) —
alongside **hackathons** (MLH, Devpost, DoraHacks, ETHGlobal, Luma AI/Tech) and
**community tech events** across the Greater Toronto Area, Ottawa, Montreal and
Quebec City. North-America scoped (Canada-first), auto-scraped, deduplicated, and
exportable to Google / Outlook / Apple Calendar (+ iCal). The footer/hero show an
**"Updated X ago"** indicator backed by the last scrape time.

Pipeline: `cron → scrapers → normalize + dedup (fingerprint) → MongoDB → API → feed UI → calendar`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · MongoDB + Mongoose (Atlas) ·
PostHog · Apify (Eventbrite/Meetup actors) · GitHub Actions cron.

## Getting started

```bash
cp .env.example .env.local   # fill in MONGODB_URI, CRON_SECRET, APIFY_TOKEN, ...
npm install
npm run dev
```

Open http://localhost:3000. Trigger a scrape against the dev server:

```bash
curl -X POST http://localhost:3000/api/refresh \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sources":["luma","mlh","hackathon","company"]}'   # omit body to run all sources
```

## Interface

A calm, dense dark UI (lu.ma / Linear / Vercel as references):

- **`/events`** — a **date-grouped timeline** (Today / Tomorrow / weekday rails). Browsing
  leads with events: a single **Filters** popover (with removable active-filter chips)
  replaces a wall of dropdowns, and lane tabs (All / Companies / Hackathons / Local) shape
  the view. Still-running hackathons (long submission windows) surface under "Today".
- **Home** — curated sections: company events (primary), hackathons (distinct), a
  Canada-first local layer, then U.S. and Online — each with a consistent header.
- **Detail** — calendar export (Google / Outlook / Apple / iCal), schema.org `Event`
  JSON-LD, related events, and an outbound register link to the source.
- **Freshness** — "Updated X ago" in the hero + footer, from the `meta` collection the
  refresh route writes (falls back to the newest event's timestamp).

## How it's organized

| Where | What |
|---|---|
| `lib/fetchers/` | Per-source scrapers + `config.ts` (cities, company registry, caps) |
| `lib/scrape.ts` | scrape → normalize → fingerprint → bulk upsert pipeline |
| `database/` | Mongoose models, normalization, dedup fingerprint |
| `lib/events.ts` | Server data layer the pages query directly |
| `app/api/` | Public API: `GET /api/events`, `GET /api/events/[slug]`, `POST /api/refresh` |
| `app/`, `components/` | Home sections, `/events` filter/search feed, event detail + calendar export |
| `.github/workflows/scrape.yml` | Nightly cron (free sources) + weekly (paid Apify sources) |
| `.claude/docs/` | Project knowledge base: CONTEXT, decisions (ADRs), gotchas |

**Sources** — Luma (direct public JSON API, free), MLH (embedded season-page JSON),
company registry (provider-agnostic: generic Luma-calendar + WordPress Events Calendar
adapters, and bespoke platform adapters in `lib/fetchers/companies/` for Google, AWS,
Microsoft Reactor, Y Combinator, NVIDIA, Tesla, Databricks, Snowflake, Figma — add a
company in one line in `lib/fetchers/config.ts`), the **`hackathon` aggregate source**
(`lib/fetchers/hackathons.ts` — Devpost online slice, lu.ma AI/Tech discover, DoraHacks
virtual, ETHGlobal; all free public endpoints, each provider isolated and scoped to
online or CA/US, capped to ≤120-day windows to drop perpetual "marathon" listings),
and Eventbrite + Meetup (paid Apify actors, capped via `SCRAPE_MAX_ITEMS`). All
endpoints were live-verified — fetch strategies and traps are documented in
`.claude/docs/gotchas.md`. The scheduled-scrape setup lives in `docs/scheduled-scrape.md`.

## Deploy

Vercel + MongoDB Atlas. Set env vars from `.env.example`, then add `SITE_URL` and
`CRON_SECRET` as GitHub repo secrets so the scheduled workflow can hit
`POST /api/refresh` on the deployment.
