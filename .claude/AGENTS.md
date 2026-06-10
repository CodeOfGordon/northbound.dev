# Tech Event Aggregator — Agent Architecture

## Project Purpose
A web application that scrapes upcoming tech/AI/data company dev & networking events and hackathons from multiple sources (Luma, Eventbrite, Meetup, direct company websites, MLH website for hackathons), normalizes them into a unified feed, and lets users filter/search events and add them to Google, Outlook, or Apple Calendar. Primary region: the Greater Toronto Area.

---

## Tech Stack & Hard Constraints

- **Framework**: Next.js **16.2.6** (App Router) + React 19.2.4, TypeScript, Tailwind v4, shadcn / radix-ui.
- **Database**: **MongoDB + Mongoose** (see `.claude/docs/decisions.md` → ADR-001). Models live in `database/` (`event.model.ts`, `booking.model.ts`); the cached connection is `database/mongodb.ts` (`connectDB()`); the barrel is `database/index.ts`. **Not Supabase / Postgres / Prisma.**
- **Analytics**: PostHog (`posthog-js`, `instrumentation-client.ts`, `/ingest` reverse proxy in `next.config.ts`).
- **MCP servers**: configured in `.mcp.json` — `mongodb`, `apify`, `playwright`, `fetch`, `brave-search`. Secrets go in `.env.local` (template: `.env.example`).

> ⚠️ **This is NOT the Next.js you know.** Next.js 16 has breaking changes versus older versions and versus model training data — APIs, conventions, and file structure may all differ. The bundled docs at `node_modules/next/dist/docs/01-app` are the **source of truth**: read the relevant guide before writing any route handler, data-fetching, caching, or config code. Heed deprecation notices.

---

## Agent Roles

### 1. `scraper-agent`
**Responsibility**: Discovers and extracts raw event data from event platforms.
- Sources: Luma (lu.ma), Eventbrite, Meetup.com, and JS-heavy company pages (AWS, Databricks, GDG/Bevy, RBC).
- Tools: Apify MCP (`@apify/actors-mcp-server`) for Luma/Eventbrite/Meetup actors; Playwright MCP for JS-heavy pages; fetch MCP for static pages (MLH, Communitech, Hackathons.ca); Brave Search MCP to discover URLs first.
- Output: Raw JSON event objects → hands off to `normalizer-agent`.
- Skills: `.claude/skills/event-scraping/`, `.claude/skills/apify-actors/`

### 2. `normalizer-agent`
**Responsibility**: Transforms raw scraped data into the canonical `Event` schema and deduplicates events that appear on multiple platforms.
- Input: Raw arrays from each scraper.
- Output: `Event` documents upserted into **MongoDB** via Mongoose (the `database/` models), deduplicated on `fingerprint`.
- Skills: `.claude/skills/data-schema/`, `.claude/skills/deduplication/`

### 3. `backend-agent`
**Responsibility**: Manages the API the frontend calls.
- Stack: Next.js 16 App Router **route handlers** (`app/api/.../route.ts`), deployed on Vercel.
- Database: MongoDB (Mongoose + Atlas).
- Endpoints: `GET /api/events` (filter by type, date, city, mode, free/paid, keyword), `GET /api/events/[slug]`, `POST /api/refresh` (cron-triggered scrape, guarded by `CRON_SECRET`).
- Skills: `.claude/skills/backend-api/`, `.claude/skills/database/`

### 4. `frontend-agent`
**Responsibility**: Builds the React/Next.js UI.
- Event card grid with filters (type, date range, city, virtual/in-person, free/paid).
- "Add to Calendar" button on each card (Google, Outlook, Apple, iCal).
- Skills: `.claude/skills/frontend/`, `.claude/skills/calendar-button/`

### 5. `scheduler-agent`
**Responsibility**: Triggers the scraper on a cron schedule (e.g., nightly) and handles cache invalidation.
- Tool: Vercel Cron Jobs or a GitHub Actions scheduled workflow hitting `POST /api/refresh`.
- Skills: `.claude/skills/scheduling/`

---

## Communication Flow

```
scheduler-agent ──cron──▶ scraper-agent
                                │
                          raw JSON blobs
                                │
                         normalizer-agent
                                │
                        canonical Event[]
                                │
                        MongoDB (Mongoose)
                                │
                          backend-agent (API)
                                │
                         frontend-agent (UI)
                                │
                      User ──▶ Calendar App
```

---

## Handoff Protocol
- Every agent reads `.claude/docs/CONTEXT.md` before acting.
- Architectural decisions are recorded in `.claude/docs/decisions.md`.
- Blockers and non-obvious behaviors are logged in `.claude/docs/gotchas.md`.
- All external library patterns live in `.claude/skills/` as invokable skills — index at `.claude/skills/README.md`.
- Source references (docs, repos) live in `.claude/docs/REFERENCES.md`.
- MCP servers are configured in `.mcp.json`; secrets go in `.env.local` (see `.env.example`).
