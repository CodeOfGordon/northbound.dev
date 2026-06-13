# DevEvents

One feed of **official dev events from big tech & AI companies** (Google, AWS,
Microsoft Reactor, NVIDIA, Y Combinator, Tesla, Databricks, Snowflake, Figma, plus
Luma calendars for DeepMind, Modal, Cursor, LangChain, Cloudflare, Cohere and more) —
alongside **hackathons** (MLH, NVIDIA) and **community tech events** across the
Greater Toronto Area, Ottawa, Montreal and Quebec City. Auto-scraped, deduplicated,
and exportable to Google / Outlook / Apple Calendar (+ iCal).

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
  -d '{"sources":["luma","mlh","company"]}'   # omit body to run all sources
```

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
company in one line in `lib/fetchers/config.ts`), Eventbrite + Meetup (paid Apify
actors, capped via `SCRAPE_MAX_ITEMS`). All company endpoints were live-verified —
fetch strategies and traps are documented in `.claude/docs/gotchas.md`.

## Deploy

Vercel + MongoDB Atlas. Set env vars from `.env.example`, then add `SITE_URL` and
`CRON_SECRET` as GitHub repo secrets so the scheduled workflow can hit
`POST /api/refresh` on the deployment.
