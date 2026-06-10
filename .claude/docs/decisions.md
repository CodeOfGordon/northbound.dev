# Architectural Decision Record

Each entry: **Context → Decision → Rationale → Consequences**. Newest decisions append to the bottom. Agents log new architectural choices here (per `AGENTS.md` handoff protocol).

---

## ADR-001 — Database: MongoDB + Mongoose
**Status**: Accepted · 2026-06-08

**Context**: The prefilled `AGENTS.md`/`SKILLS.md`/`gotchas.md` described Supabase (Postgres + RLS), but the repo already contained working Mongoose models (`database/event.model.ts`, `database/booking.model.ts`) and a cached connection (`database/mongodb.ts`). The two had to be reconciled.

**Decision**: Standardize on **MongoDB + Mongoose**. Drop Supabase/Postgres. Install the official **MongoDB MCP server** (`mongodb-mcp-server`) for schema/query/migration tooling.

**Rationale**:
- Working code already exists — choosing Mongo discards nothing; choosing Supabase would mean rewriting validated models, hooks, and indexes.
- Scraped events are **heterogeneous** across sources (fields present on Luma differ from Eventbrite, MLH, company pages). A document model absorbs that variance without rigid migrations.
- Dedup is a natural `updateOne({ fingerprint }, …, { upsert: true })` — no join/constraint gymnastics.
- Mongoose pre-save hooks already perform slug/date/time normalization — exactly the normalizer-agent's job.
- Atlas free tier (M0) + Atlas Search cover hosting and full-text.

**Consequences**: Full-text search uses a Mongoose `text` index (or Atlas Search `$search`) rather than Postgres FTS. No RLS — booking/auth rules are enforced in app/server code. The `date` field is stored as a `YYYY-MM-DD` **string**, so date-range filters rely on lexical comparison (works because the format sorts lexically). Alternatives rejected: **Supabase** (rewrite cost, weaker fit for heterogeneous data), **Prisma** (adds an ORM layer with no clear benefit here; Prisma+Mongo loses some Mongo features).

---

## ADR-002 — Repository structure consolidated under `.claude/`
**Status**: Accepted · 2026-06-08

**Decision**: Agent knowledge lives under `.claude/`:
- `.claude/skills/<name>/SKILL.md` — 9 invokable Claude Code skills (auto-discovered via frontmatter).
- `.claude/docs/{CONTEXT,decisions,gotchas,REFERENCES}.md` — knowledge docs.
- `.claude/skills/README.md` — skills index.
- `.mcp.json` (repo root) — MCP server config.
- `AGENTS.md` + `CLAUDE.md` stay at repo root (`CLAUDE.md` imports `@AGENTS.md`).

**Rationale**: Real skills (vs plain reference `.md`) are auto-surfaced and invokable, matching the existing PostHog skill at `.claude/skills/integration-nextjs-app-router/`. Grouping docs keeps the repo root clean.

**Consequences**: The old root `SKILLS.md` and `gotchas.md` were superseded by `.claude/skills/README.md` and `.claude/docs/gotchas.md` and removed. `AGENTS.md` handoff paths were updated to the `.claude/` locations.

---

## ADR-003 — MCP server set
**Status**: Accepted · 2026-06-08

**Decision**: `.mcp.json` declares five servers (verified package names/commands as of 2026-06-08):

| Server | Command | Secret (env) | Notes |
|---|---|---|---|
| `mongodb` | `npx -y mongodb-mcp-server@latest --readOnly` | `MDB_MCP_CONNECTION_STRING` | `--readOnly` blocks writes; remove to allow migrations. Same value as `MONGODB_URI`. |
| `apify` | `npx -y @apify/actors-mcp-server --tools actors,docs` | `APIFY_TOKEN` | Replaces deprecated `--actors` flag. Hosted alt: `https://mcp.apify.com`. |
| `playwright` | `npx -y @playwright/mcp@latest --headless --isolated` | — | First run downloads browsers: `npx playwright install chromium`. |
| `fetch` | `uvx mcp-server-fetch` | — | **Python** server — needs `uv` installed (not npm). |
| `brave-search` | `npx -y @brave/brave-search-mcp-server --transport stdio` | `BRAVE_API_KEY` | Current package; replaces deprecated `@modelcontextprotocol/server-brave-search`. |

**Consequences**: No Supabase MCP. `apify`/`brave-search` need paid-ish keys (Brave has a free ~2k/mo tier); `fetch` needs `uv`; `playwright` needs a one-time browser download. App + MCP read secrets from `.env.local` (template `.env.example`).

---

## ADR-004 — Scraping strategy (tool per source)
**Status**: Accepted · 2026-06-08

**Decision**: Pick the cheapest tool that works per source:
- **Apify actors** → Luma (`mhamas/luma-calendar-events-scraper`), Eventbrite (`parseforge/eventbrite-scraper`, city slug form `toronto--ontario`), Meetup (`easyapi/meetup-events-scraper`).
- **fetch MCP** → static HTML (mlh.io/seasons, communitech.ca/events, hackathons.ca).
- **Playwright MCP** → JS-heavy company pages (AWS, Databricks, GDG/Bevy, RBC).
- **Brave Search MCP** → discover event URLs before scraping ("[company] Toronto developer event").

Scrapers emit **raw JSON only**; the normalizer-agent converts raw → canonical `Event`.

**Consequences**: Apify REST uses async run + poll (`waitForFinish`), Bearer auth, `maxItems` capped during dev to protect free-tier credits. See `.claude/skills/event-scraping/` and `.claude/skills/apify-actors/`.

---

## ADR-005 — Deduplication via content fingerprint
**Status**: Accepted · 2026-06-08

**Decision**: `fingerprint = sha256( lowercased trimmed title + "|" + date(YYYY-MM-DD) + "|" + lowercased city )`. **Time is excluded** (sources disagree by minutes). Upsert on `fingerprint` via `updateOne(..., { upsert: true })` / `bulkWrite`; `fingerprint` gets a **unique sparse** index.

**Consequences**: The same event on multiple platforms collapses to one document. E11000 races are handled idempotently. Merge policy: keep the richest description, prefer the source carrying the canonical `url`. See `.claude/skills/deduplication/`.

---

## ADR-006 — Calendar export: `add-to-calendar-button-react`
**Status**: Accepted · 2026-06-08

**Decision**: Use `add-to-calendar-button-react` (Web Component wrapper) inside a `"use client"` component. Map `Event.date → startDate` (YYYY-MM-DD), `Event.time → startTime` (HH:MM), `Event.timezone → timeZone` (IANA). Supports Google/Outlook/Apple/Yahoo/iCal with **no backend and no OAuth**.

**Consequences**: SSR/hydration handled via client-only mount (`dynamic(..., { ssr: false })`). A hand-built Google-URL + `.ics` blob is documented as a fallback. See `.claude/skills/calendar-button/`.

---

## ADR-007 — Scheduling: cron → `POST /api/refresh`
**Status**: Accepted · 2026-06-08

**Decision**: A nightly cron (Vercel Cron via `vercel.json`, or a GitHub Actions scheduled workflow) calls `POST /api/refresh`, guarded by `CRON_SECRET` in the `Authorization` header. The endpoint runs the scrape → normalize → upsert pipeline and busts the events-feed cache.

**Consequences**: Vercel free-tier cron is once-daily minimum; use GitHub Actions for finer cadence. See `.claude/skills/scheduling/`.

---

## ADR-008 — Event schema extensions for aggregation
**Status**: Accepted · 2026-06-08

**Context**: The existing `Event` model was built for hand-authored events; scraped events need provenance and dedup fields, and can't always supply every current required field.

**Decision**: Extend the Mongoose `Event` model with: `url` (canonical source link — required for this product), `source`, `sourceId`, `fingerprint` (unique sparse), `timezone` (IANA, default `America/Toronto`), optional `endDate`/`endTime`, `isFree`/`price`, and `category` (enum `hackathon | meetup | conference | networking`). **Relax** requireds that scraped sources often lack (`overview`, `agenda`, `audience`). (Field name is `category` — single canonical name, matching CONTEXT.md §6 and the `data-schema` skill; do not introduce a parallel `eventType`.)

**Consequences**: A schema migration/update to `database/event.model.ts` is pending implementation. See `.claude/skills/data-schema/`.

---

## Known follow-ups / tech debt
Surfaced during the agent-docs review (2026-06-08) — these are existing **code** issues, not doc issues:
- `database/mongodb.ts:2` has a stray unused `import { cachedDataVersionTag } from 'v8';` — remove it.
- `database/event.model.ts` `normalizeDate()` uses `new Date(dateString).toISOString()`, which can shift a local date by one day across timezones. Consider parsing as UTC or keeping the date string as-is when already `YYYY-MM-DD`.
