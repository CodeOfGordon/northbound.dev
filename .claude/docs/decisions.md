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

## ADR-009 — Luma via its direct public JSON API (supersedes the ADR-004 Luma actor)
**Status**: Accepted · 2026-06-10

**Context**: ADR-004 picked the `mhamas/luma-calendar-events-scraper` Apify actor (72% success rate, 26 users). While verifying it, `api.lu.ma` turned out to answer unauthenticated JSON for everything we need.

**Decision**: Scrape Luma directly: `GET api.lu.ma/url?url=<slug>` resolves a slug to a **discover-place** (toronto, montreal) or **calendar** (ottawa, company calendars); then `discover/get-paginated-events?discover_place_api_id=…` / `calendar/get-items?calendar_api_id=…&period=future` return full event entries (event + calendar + hosts + ticket_info). No Apify, no credits, ~2 s for all cities.

**Consequences**: Free and fast; the biggest-volume source costs nothing nightly. It is an *unofficial* API — if Luma locks it down, fall back to the ADR-004 actor (the fetcher interface hides the mechanism). Luma's robots.txt only restricts Googlebot on a few paths. List entries carry no description — `normalizeRawEvent` synthesizes one (schema requires it).

---

## ADR-010 — Company sources: provider-agnostic registry, not per-company scrapers
**Status**: Accepted · 2026-06-10

**Context**: The user wants company dev-event pages (AI labs, big tech, banks) covered, but company-site scrapers rot fast and most companies have no stable feed.

**Decision**: `company` is a **registry** (`lib/fetchers/config.ts` → `COMPANY_SOURCES`): each entry maps a company to one of the generic **provider adapters** in `lib/fetchers/company.ts` — currently `luma` (any company Luma calendar, e.g. Cohere `cal-400NOkbFqzrkJNA`, Notion Toronto `notiontoronto`) and `tribe` (any WordPress site running The Events Calendar, e.g. Vector Institute). Adding a company on a supported platform is one config line; a new platform is one adapter.

**Investigated and skipped**: GDG/Bevy (`gdg.community.dev` robots.txt disallows `/api/` for all agents; pages are a JS SPA), Microsoft Reactor (JS-only SPA, unstable), Shopify/Notion-corp/banks incl. Capital One, RBC/Borealis, TD (no public dev-events feed — their events surface on the Luma/Eventbrite/Meetup city feeds, which we already scrape). Mila (Drupal, no structured feed; Montreal covered by city feeds).

**Consequences**: Quality over quantity — `company` only carries sources that won't silently rot. The amber "Company" treatment in the UI keys off `source === 'company'`.

---

## ADR-011 — Region set: GTA + Ottawa + Montreal + Quebec City
**Status**: Accepted · 2026-06-10

City slugs/queries per source live in `lib/fetchers/config.ts`: Luma (toronto, montreal, ottawa — no Quebec City discovery page exists), Eventbrite (`canada--toronto`, `canada--mississauga`, `canada--ottawa`, `canada--montreal`), Meetup (Toronto, Ottawa, Montréal, Québec), MLH (all Ontario/Quebec + digital). `normalize.ts` canonicalizes spellings (Montréal→Montreal, Québec→Quebec City) so filters and fingerprints agree across sources.

---

## ADR-012 — Frontend reads Mongo directly in server components
**Status**: Accepted · 2026-06-10

Pages query Mongoose via `lib/events.ts` (returns plain serializable `EventDoc`s) instead of fetching `/api/events` over HTTP — no self-HTTP hop; the API route stays as the external surface with identical filter semantics. Event images render via plain `<img>` with an error fallback (`components/EventImage.tsx`) because scraped image hosts are arbitrary and `next/image` `remotePatterns` can't enumerate them.

---

## ADR-013 — Bespoke company-platform adapters + CompanyStdEvent (extends ADR-010)
**Status**: Accepted · 2026-06-11

**Context**: The registry model (ADR-010) covered only Luma/tribe platforms, so FAANG-class
companies (the product's intended hero content) contributed zero events. A 12-agent research
pass live-verified a server-fetchable feed for every major target — including Microsoft
Reactor, which ADR-010 wrote off as a JS-only SPA (its SPA calls an open JSON API:
`developer.microsoft.com/reactor/api/events`).

**Decision**: Keep the registry, add a layer of **bespoke platform adapters** in
`lib/fetchers/companies/` (google devsite HTML, aws directory API, reactor API, yc
Inertia data-page, nvidia AEM DAM JSON, tesla events API, databricks Gatsby page-data,
snowflake AEM `__INITIAL_STATE__`, figma RSC flight payload). All emit one shared
intermediate shape — `CompanyStdEvent` (`companies/shared.ts`) — so `normalize.ts` has
exactly one mapper (`mapStdCompanyEvent`) for every bespoke platform. Companies on Luma
remain pure config: DeepMind, Modal, Cursor, LangChain, Cloudflare, Hugging Face, W&B,
Vercel, Perplexity, ElevenLabs, Linear were added by `calendar_api_id` (several had 0
upcoming events on add-day; they cost one request and populate themselves).

**Still skipped**: GDG/Bevy + CNCF community (the API works unauthenticated but
robots.txt disallows `/api/` — etiquette call, unchanged from ADR-010), Apple/Meta/OpenAI/
Anthropic (no public feed or empty Luma calendars under squatted vanity slugs).

**Consequences**: `source: 'company'` went from 3 orgs to 24; events are now global
(city/country are free-text worldwide, 'Online', or 'TBA'), so company events bypass the
ADR-011 region scoping by design. Scraper upsert slugs now include the event date —
recurring series (Reactor, Figma webinars) reuse titles across dates and a bare-title
slug would E11000-drop every later occurrence. Per-feed traps live in gotchas.md.

---

## ADR-014 — Home hierarchy: official company events first (dev.events teardown)
**Status**: Accepted · 2026-06-11

A structural teardown of dev.events informed the redesign: hierarchy is expressed in
order and URL structure, not just styling. Home = company events (primary grid +
organizer chip links), hackathons (distinct tinted container), community/local rails
(de-emphasized, scoped to luma/eventbrite/meetup so company events don't repeat).
`organizer` is now a first-class filter (`queryEvents`, `/api/events`, `/events?organizer=`).
Detail pages emit schema.org Event JSON-LD (dev.events both emits it and *watches
organizer sites for it* to auto-relist editions — emitting makes us machine-readable
to search engines and other aggregators). Deliberately not copied: per-event ICS
endpoints (AddToCalendar covers it) and iframe detail pages (X-Frame-Options breaks
corporate sites; we link out instead).

---

## ADR-015 — North-America scope: geo classifier + region gate (refines ADR-013)
**Status**: Accepted · 2026-06-13

**Context**: The bespoke company adapters (ADR-013) pull GLOBAL events — a single
company scrape produced in-person events in Bengaluru, London, Sydney, Paris, Seoul,
etc. The product is for a Toronto-based user: Canada-first, US welcome, the rest noise.
The stored `country` was useless for filtering (58/122 company events were 'TBA' because
adapters only captured a city), so the real signal is the `city` string.

**Decision**: A self-contained classifier `lib/fetchers/geo.ts` — `classifyRegion({city,
country, venue, online, regions})` → `{ country, region: 'CA'|'US'|'ONLINE'|'INTL'|'UNKNOWN',
isNorthAmerica }` — backed by a curated world-city DB plus US-state / Canadian-province /
country-name detection. `normalize.ts` runs it for EVERY source, setting a clean canonical
`country` and a new persisted+indexed `region` field (non-NA, incl. region-hint-excluded
online events, collapse to `INTL`). `lib/scrape.ts` drops `region === 'INTL'` before upsert,
so foreign events never enter the DB. The 3 adapters whose source exposes an authoritative
audience region (NVIDIA `regions`, Databricks `fieldEventRegions`, Microsoft `regions`) pass
it as `_regions` so online/ambiguous events classify correctly. Also in geo.ts: `cleanTitle()`
(applied to all titles) repairs run-together scraped titles, e.g. `//localhost:bengaluru`
→ `//localhost: Bengaluru`, without mangling well-formed ones.

**Conservative by design**: only POSITIVELY-foreign events (`INTL`) are dropped; `UNKNOWN`
(bare 'TBA', 'Hybrid Event', unrecognized cities) is kept — better to show an
unclassifiable AWS webinar than to silently drop a real NA event. Bare `London` →
United Kingdom; only `London, ON` → Canada (documented in geo.ts).

**Consequences**: Company events went 122 → 74 (foreign dropped), distribution CA 48 /
US 32 / Online 28 / Unknown 6 / INTL 0. The `region` field powers the `/events?region=`
filter and the home page's Canada/US/Online sections (ADR-016). A misspelled source city
('Syndey') can slip through as `UNKNOWN`; acceptable. Mexico is treated as INTL despite
being geographically North American — the product means Canada + US.

---

## ADR-016 — Home IA: North America, Canada-first, US + Online secondary (refines ADR-014)
**Status**: Accepted · 2026-06-13

Home order: hero ("Official Dev Events Across North America") → **Company events**
(primary, soonest-per-company highlights + organizer chips) → **Hackathons** (distinct
tinted container) → **In Canada** (Canadian city rails, all sources — the user's
primary-use layer) → **In the United States** (US company events, secondary) → **Online**.
Cards carry a country flag (🇨🇦/🇺🇸/🌐 via `COUNTRY_FLAG`). A `region` select leads the
FilterBar. Community sources (Luma/Eventbrite/Meetup/MLH) remain Canada-scoped by their
city/season queries, so the region gate is a no-op for them in practice (verified: 0 of 40
community events classified INTL).

---

## ADR-017 — UX lanes, company directory, consumer-event filter (refines ADR-016)
**Status**: Accepted · 2026-06-13

**Context**: Feedback after ADR-016: (1) the company feed felt barren and Tesla-
dominated (13 consumer "Father's Day"/store events); (2) the city dropdown only ever
showed Canadian cities even under region=US; (3) Luma vs Eventbrite vs Meetup is a
meaningless distinction to someone browsing; (4) the single filter bar carried all the
structure. User also asked to surface *which* companies are tracked, grouped by industry.

**Decisions**:
- **Lanes** replace source-as-filter: Companies (`source=company`), Hackathons
  (`category=hackathon`), Local (`source=local` → Luma+Eventbrite+Meetup collapsed),
  All. `/events` shows lane tabs + a per-lane title and a contextual FilterBar (only the
  filters that matter for that lane). Card/detail badges show the lane (Company/Hackathon/
  Local), not the platform. `laneOf()` in constants.ts is the single source of truth.
  Real platform names are kept only where they matter (RegisterButton).
- **Company directory** (`components/CompanyDirectory.tsx`): every tracked company grouped
  by `industry` (new field on each `COMPANY_SOURCES` entry; `INDUSTRY_ORDER` +
  `COMPANY_DIRECTORY` exports), shown on the company lane with live counts; 0-count
  companies stay listed (dimmed) so coverage is visible. Each chip filters by `organizer`.
- **Consumer-event filter**: `isConsumerEvent()` (relevance.ts) drops retail noise
  (Father's Day, test drive, store events) from ALL company feeds; consumer brands flagged
  `devOnly` (Tesla) additionally require `isRelevant(title+description)` — NOT tags, which
  always carry a baseline 'tech' tag that would match everything. Tesla → 0 events (stays
  in the directory as tracked-but-inactive).
- **Region-aware cities**: `distinctCities(region)` derives the city dropdown from real
  data scoped to the region, so US shows US cities. The hardcoded `CITIES` list is retired
  from the dropdown.

**Consequences**: Company feed went from ~15 events (Tesla-heavy) to ~93 across ~28 active
companies (38 tracked). Canadian company dev events are genuinely sparse — best Canadian
coverage comes from ecosystem hubs (Communitech, MaRS, Vector Institute) + the Canada-scoped
city feeds, not big-tech company calendars (most have none). Adding a company is still one
config line (now with an `industry`).

---

## ADR-018 — Hackathon application/travel schema + field-ownership wipe safety (2026-08-16)

**Decision**: Event docs gain `applicationStatus` (`open|closed|not_yet|unknown`) +
`applicationDeadline` (YYYY-MM-DD, lexical — I5), both **scrape-owned** (emitted only by
mappers that truly know them: Devpost `open_state`); `notifiedOpenAt` (Date, **digest-owned**);
and an `enrichment` subdocument (**enrichment-script-owned**: host, checkedAt, source
site|curated, fetchStatus, application{status,deadline,evidence}, travel{status,amount,evidence}).
**Ownership rule**: the scrape upsert `$set: doc` overwrites exactly the paths present in
`CanonicalEvent` — so `enrichment` and `notifiedOpenAt` are excluded from the `Omit<>` in
normalize.ts and MUST stay excluded; that exclusion is the entire wipe-safety mechanism
(verified live: MLH rescrape modified 55 docs, enrichment subdocs survived intact).
`lib/hackathon.ts` (`applicationSignal`/`travelSignal`) is the only merge point components use.
No new indexes. Date presets gained `quarter` (+92d) / `half` (+183d); the hackathon lane
defaults to a 6-month month-grouped FORWARD calendar (`includeOngoing` off there — dozens of
already-started online challenges clamped into "today" and buried the planning view).

---

## ADR-019 — Hackathon source widening: MLH US, Devpost in-person, watchlist (2026-08-16)

- **MLH**: in-person events now kept for ALL of the US (CA stays narrowed to ON/QC) — the
  travel-reimbursement feature is about flying to the majors. Season URLs moved to
  `www.mlh.com` (mlh.io 302s there). Hackathon lane grew ~46 docs on first run.
- **Devpost**: second slice `challenge_type[]=in-person` alongside online; `open_state`
  open|upcoming → `applicationStatus:'open'` (registration is possible in both — the
  submission window starting later doesn't block joining; revisit if wrong, it's one line);
  `submission_period_dates` end → `applicationDeadline`. In-person items must classify
  positively to US/CA via `classifyRegion` in the fetcher — free-text venue names default
  to region UNKNOWN which the generic gate KEEPS, and that leaked University of Sydney into
  the feed on the first live run. Precision over recall.
- **New `watchlist` source** (`lib/fetchers/watchlist.ts` + `lib/data/watchlist.ts`): curated
  named hackathons absent from MLH/aggregators (HackMIT, Cal Hacks, PennApps, BigRed//Hacks,
  SproutGT, HackHarvard→hhuh.io, HooHacks, YHack, TreeHacks, McHacks). Polls each official
  site nightly; extracts announced dates from title+meta+body (most are SPA blanks — raw
  hackmit.org HTML is 14 chars of text), with curated `knownNext` fallback dates, all guarded
  to FUTURE dates only. **No next-year guess for yearless date strings** — a stale page
  ("January 17-18" on mchacks.ca) fabricated a 2027 edition on the first live run; removed.
  MLH city strings get trailing commas stripped in the MLH mapper only (a global
  canonicalCity change would re-fingerprint stored docs, e.g. "Washington, D.C.").
  Duplicates with MLH listings dedup via the frozen fingerprint.

---

## ADR-020 — Enrichment stage runs in GitHub Actions, writes to Atlas directly (2026-08-16)

`scripts/enrich-hackathons.mjs` (+ `scripts/hackathon-overrides.json`) fetches each in-person
US/CA hackathon's own site + FAQ and writes ONLY the `enrichment` subdoc (see ADR-018).
**Why not a Vercel route**: per-site fetches of arbitrary hackathon sites are slow/flaky and
the Hobby function ceiling is unresolved (~60s assumption, W6); the GH runner has free
minutes and no cap; direct-to-Atlas .mjs has precedent (diagnostics scripts). **Budgets**:
25 hosts/run (dispatch input `enrich_budget` for backfills), ≤2 pages/host (landing + one
same-host FAQ link), 10s timeouts, 1.5s inter-request sleep, no retries; staleness cadence
3d (event <60d out) / 7d (else) / 7d backoff on fetch_failed/blocked. **Classifiers**:
application closed→not_yet→open precedence with evidence snippets (±120 chars, ≤280);
travel has a mention-gate and **silence maps to 'unknown', never 'no'**; verb stems not
literals ("providing" missed by 'provide' — live uofthacks.com miss, fixed). Hostname-keyed
curated overrides carry travel policy ONLY (application state is time-varying and would rot).
New trust surface: `MONGODB_URI` repo secret; Atlas network access must allow GH runners.

---

## ADR-021 — Daily interest digest via Resend HTTP API, at-least-once (2026-08-16)

One nightly email to `DIGEST_EMAIL` when something matched: (A) new events since cursor
matching `config/interests.ts` (typed rules in git — no auth exists, so no web form; a
`minDaysOut` field keeps hackathons months-out per gordon's ask), (B) applications-now-open,
(C) deadline reminders at exactly {7,3,1} days (stateless). Cursor = `meta` singleton
`{key:'digest'}` (`lastDigestAt` = considered-through, advances on empty runs;
`lastSentAt` = same-day rerun guard). **At-least-once**: cursor + markers advance only after
Resend confirms — failure = duplicate tomorrow, never a silent miss. First run initializes
without emailing history. Email = single 600px table, inline styles, explicit light palette
(Gmail forced-dark inverts sanely), plain-text fallback, links to site detail pages +
outbound Apply. **No `resend` npm dependency** — raw fetch to `api.resend.com/emails`
(~15 lines) keeps package.json unchanged; sender `onboarding@resend.dev` (unverified-domain
sends only reach the Resend account owner → account must be created as the recipient email).

---

## ADR-022 — Applications-open notification contract (`notifiedOpenAt`) (2026-08-16)

The digest notifies about the STATE "open and not yet told" — `status=open` (scrape field
OR `enrichment.application.status`, deadline-not-passed) AND `notifiedOpenAt` absent —
then stamps `notifiedOpenAt` after a confirmed send. Chosen over enrichment-stamped
transition timestamps: self-defending against nightly re-stamps, workflow reruns, and
at-least-once resends. Contract lines: (1) `applicationStatus`/`applicationDeadline` live on
the Event doc; (2) deadlines are YYYY-MM-DD; (3) nothing may `$unset` `notifiedOpenAt`
EXCEPT (4) the enrichment script's courtesy clear on a real open→closed transition so a
later re-open re-notifies. Enumerated write surface (G2): `meta` upsert `{key:'digest'}`,
`events.updateMany` `$set notifiedOpenAt`, enrichment's `updateOne` `$set enrichment`
(+ the courtesy `$unset`). No deletes anywhere.

---

## ADR-023 — Nightly job chain + audit housekeeping (2026-08-16)

`scrape.yml` is now three chained jobs: **scrape** (curl per source; `watchlist` added to
the source list) → **enrich** (`needs: scrape, if: always()`) → **digest**
(`needs: [scrape, enrich], if: always()`) — the digest must see the night's fresh docs and
status flips; partial upstream failure must not suppress the rest; same-day guard makes
reruns safe. Rejected: separate workflows/`workflow_run` (split visibility) and a later
cron guess (races). Housekeeping approved by gordon 2026-08-16: `ogl` dependency removed
(zero imports); `/api/events` now includes `hackathon`+`watchlist` sources and projects out
`_id`/`fingerprint`/`sourceId`/`__v`; slug lookups lowercase on BOTH paths; unknown
venue/country store `''` going forward (city fallback untouched — fingerprint input);
`audience` dropped from the read path (0/707 docs, zero writers — schema field retained).

---

## ADR-024 — Online-audience gate, image fallbacks, hackathon row info (2026-08-17)

- **Audience gate**: online docs are kept by the geo gate ("joinable from anywhere"), but
  gordon flagged India/Africa/APAC-targeted online hackathons and company webinars in the
  feed. `isNonNorthAmericanAudience()` (relevance.ts) scans title+organizer+description of
  ONLINE docs for unambiguous non-NA markers (countries, major non-NA cities, APAC/EMEA/
  LATAM) — applied centrally in scrape.ts. Deliberately absent: NA-ambiguous names (London,
  Paris, Sydney) and bare demonyms. 49 stored docs cleaned up with gordon's approval
  (foreign-audience online + the pre-gate Devpost in-person UNKNOWN backlog + the 5 strays;
  full backup printed in session log).
- **Images**: watchlist fetcher now extracts `og:image` from event sites (their social-card
  banner); `EventImage` gains a `fallbackLogo` — the event site's favicon via Google's s2
  service (`siteLogo()` in lib/format) — so imageless events show the university/company/
  platform mark centered on the gradient instead of a bare placeholder icon.
- **Hackathon rows**: date range replaces the placeholder 9:00 time in the row's left
  column (the month rail only gives the month), and "apply by {date}" joins the meta line
  when applications are open with a known deadline; cards likewise swap the junk time for
  the deadline.

---

## ADR-025 — Digest delivery pivots to Gmail SMTP in the GH runner (2026-08-17)

**Why**: gordon wants recipients beyond himself at strictly $0. Resend's free tier only
delivers to the account owner without a verified custom domain (no single-sender option),
and every other ESP either needs a domain too or fails SPF/DKIM alignment when sending
"from" a gmail.com address. Gmail's own SMTP sends from the business account
(`northbound.dev.events@gmail.com`) to anyone, free (500 rcpt/day; App Password + 2FA;
still supported 2026) — but **Vercel blocks outbound SMTP**, so the send moves to the
GitHub Actions runner (like enrich).

**How — compose/confirm protocol** (no logic duplication, at-least-once preserved):
`POST /api/digest {mode:'compose', to:[...]}` builds sections + renders and returns
`{subject, html, text, to, openIds, cursor}` with NO state change (empty results advance
the considered-through cursor server-side); `scripts/send-digest.mjs` (nodemailer,
smtp.gmail.com:465) sends and then calls `{mode:'confirm', cursor, openIds}` which
advances `lastDigestAt`/`lastSentAt` and stamps `notifiedOpenAt`. A failed send exits 1
with nothing confirmed → full retry next night. New repo secrets: `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, `DIGEST_EMAIL` (comma list — friends can be appended any time).
The default-mode Resend path is retained as a local testing lever only; Vercel's
RESEND_API_KEY/DIGEST_EMAIL envs are no longer used by the nightly. `nodemailer` added
as a devDependency (runner-only, zero transitive deps).

---

## ADR-026 — Subscribers replace the env recipient list; Resend removed (2026-08-17)

**Why**: gordon wants other people (his own second address, friends) on the digest with
*their own* filters — "Canada + US hackathons, but US only when travel reimbursement is
known". A comma-separated env var can't express per-person interests, and Resend was
already limited to the account owner without a paid domain, so it is removed entirely
(no `RESEND_API_KEY`/`DIGEST_FROM`/`DIGEST_EMAIL` anywhere; Gmail SMTP from ADR-025 is
the only sender).

**Model**: new `subscribers` collection — `{email, token, status, topics[], regions[],
usTravelOnly, minDaysOut, lastDigestAt, lastSentAt, notifiedOpenIds[]}`. Delivery state
is **per subscriber**: A can be told about a hackathon B's filters exclude, and B still
hears about it if their filters later change. This retires the global
`Event.notifiedOpenAt` marker (field left in place, no longer read; the owner's history
was seeded into his `notifiedOpenIds` so the pivot didn't re-blast him).
`rulesForSubscriber()` (lib/notify/match.ts) expands checkbox prefs into matcher rules —
one per topic × region — so each email row can name why it matched; the travel filter is
scoped to the US rule only (`travel: 'yes'` requires a **confirmed** policy — unknown
never counts, matching the enrichment doctrine that silence is not a "no").

**Surfaces**: `/subscribe` (signup, and preference editing when opened with `?token=`),
`/unsubscribe?token=` (confirm page), `POST /api/subscribe`, `POST /api/unsubscribe`
(RFC 8058 one-click target; GET redirects to the page so no provider prefetch can
unsubscribe anyone). Nav + footer link to it. Tokens are 24-byte random, only ever
delivered inside emails, and never returned by the create path — so submitting someone
else's address does not hand the submitter control of their preferences.

**Compliance** (Gmail/Yahoo bulk-sender rules, RFC 2369/8058): every message carries
`List-Unsubscribe` (https + mailto) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
honored instantly (requirement is 48h); a visible unsubscribe + "change what you get"
link and a plain-language "you're receiving this because {email} subscribed" line sit in
both the HTML and text parts; sending is authenticated Gmail (SPF/DKIM/DMARC align
automatically). Volume is a handful of messages/day — far under the 5k bulk threshold —
but the same controls apply regardless.

**Runner**: `scripts/send-digest.mjs` now sends N personalized messages and confirms only
the ones that actually delivered; a per-recipient failure exits 1 (red job) while the
others still advance. Enrichment gained `--refresh-unknown` plus conventional FAQ-path
probes (`/faq`, `/faqs`, `/travel`, `/about`) because most university hackathon sites are
SPAs whose FAQ is not a plain `<a>` in raw HTML — travel coverage was 3/42 before.

---

## Known follow-ups / tech debt
- ~~`database/mongodb.ts` stray `v8` import~~ — already removed.
- ~~`normalizeDate()` UTC day-shift~~ — **fixed 2026-06-10**: `normalizeDate`/`normalizeTime` extract wall-clock parts in the event's IANA timezone (`Intl.DateTimeFormat`); `event.model.ts` reuses the same helpers.
- 8 stale Atlas docs predate the city/entity normalization fixes (city `Montréal`, one `&#8211;` title) — delete or let them age out; re-scrapes create the canonical versions.
- Meetup fetcher is the one source not yet live-verified end-to-end (Apify free credit exhausted mid-validation; item shape + plumbing verified — see gotchas).
- 4 stray docs from the 2026-08-16 live-fire test await approved deletion (MCP is readonly;
  the delete was classifier-blocked): slug `mchacks-2027-01-17` (fabricated date),
  city `"Atlanta,"` (superseded by the clean re-scrape), titles `SYNCS HACK 2026` +
  `DevLeague 2026` (foreign in-person Devpost leaks; the fetcher gate now blocks new ones).
- First real digest send will carry a one-time backlog of ~49 "applications open" rows
  (every currently-open hackathon gets its marker stamped then) — subsequent digests are
  incremental.
