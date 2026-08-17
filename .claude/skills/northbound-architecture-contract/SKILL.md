---
name: northbound-architecture-contract
description: Load-bearing architecture of Northbound (event aggregator) — the system shape, the 17-ADR decision digest, the invariants you must not break (fingerprint recipe, slug-at-insert, string dates, pre-save-hooks-never-run-on-bulkWrite, force-dynamic, Mongoose 9 / modified Next 16 rules), and the known-weak points (prod data in db 'test', /api/events drift, slug E11000 hole, lane triplication). Load before ANY change that touches the scrape pipeline, the Event schema, queries, dedup, caching, or API routes — or when asked "how does Northbound work" / "why is it built this way" / "is it safe to change X".
---

# Northbound architecture contract

Northbound is a dev-event aggregator: Next.js 16.2.6 App Router + React 19 + TS + Tailwind v4,
Mongoose 9 on MongoDB Atlas (free M0), deployed on Vercel (Hobby), scraped nightly by a GitHub
Actions cron. This skill is the contract: what the system IS, why, what must stay true, and
where it is known to be weak. `.claude/docs/decisions.md` holds the full ADR rationale — this
skill summarizes and links; it does not replace it.

Hard gates that shape the architecture (full text + incidents: **northbound-change-control**):
$0 hosting (paid Apify sources are never scheduled), the live Atlas cluster IS production (no
staging; MongoDB MCP is `--readOnly`; no writes outside the scrape pipeline without approval),
PRODUCT.md/DESIGN.md are law for UI, commits are gordon-authored on explicit request only.

## (a) System shape

One write path, one read path, zero caching layers. As of 2026-07-20:

```
GitHub Actions cron (.github/workflows/scrape.yml, '15 7 * * *', free sources only)
  └─ POST /api/refresh  (app/api/refresh/route.ts — Bearer CRON_SECRET, fail-closed)
       └─ runScrape()  (lib/scrape.ts)
            └─ FETCHERS map — 7 sources (7th, `watchlist`, added 2026-08-16 — ADR-019):
                 luma       lib/fetchers/luma.ts        free direct api.lu.ma JSON
                 eventbrite lib/fetchers/eventbrite.ts  PAID Apify actor (manual-only)
                 meetup     lib/fetchers/meetup.ts      PAID Apify actor (manual-only, never live-verified)
                 mlh        lib/fetchers/mlh.ts         free fetch of www.mlh.com season pages (US in-person widened, CA still ON/QC)
                 company    lib/fetchers/company.ts     38-entry registry → 11 provider adapters
                 hackathon  lib/fetchers/hackathons.ts  devpost (online+in-person) + luma-discover + dorahacks + ethglobal
                 watchlist  lib/fetchers/watchlist.ts   curated named hackathons polled off their own sites (HackMIT, Cal Hacks, PennApps, …)
            └─ per raw item:
                 normalizeRawEvent(item, source)   database/normalize.ts
                   (cleanTitle, canonicalCity, tz-aware date/time, classifyRegion)
                 → drop if doc.region === 'INTL'   (geo gate — online/UNKNOWN kept)
                 → company only: drop isConsumerEvent(); DEV_ONLY_COMPANIES also need isRelevant()
                 → buildFingerprint(doc)           database/fingerprint.ts
                 → bulkWrite updateOne { filter: {fingerprint},
                       update: { $set: doc,
                                 $setOnInsert: { fingerprint, slug: generateSlug(`${title} ${date}`) } },
                       upsert: true }, { ordered: false }   — E11000 absorbed as benign
       └─ writes ScrapeMeta singleton {key:'scrape'} (collection 'meta') → freshness badge

MongoDB Atlas — database 'test' (yes, really — see weak point W1), collections:
  events (473 docs as of 2026-07-19), bookings (0), meta (1)

Read path:
  pages /  /events  /events/[slug]  — server components, all force-dynamic
    └─ lib/events.ts ('server-only'): queryEvents / getHomeSections / getEventBySlug /
       distinctCities / getRelatedEvents — direct Mongoose, mapped through toDoc()
       (strips _id, fingerprint, sourceId; plain serializable EventDoc)

API routes = EXTERNAL surface with ZERO in-repo consumers (verified: no fetch('/api/…')
anywhere in app/, components/, lib/):
  GET  /api/events         — diverged from lib/events.ts, leaks internals (W2)
  GET  /api/events/[slug]  — lowercases slug (the page path does not)
  POST /api/bookings       — fully orphaned (W3)
  POST /api/refresh        — only caller is the GitHub Actions curl loop
```

The pipeline's per-item detail (adding sources/companies, Apify billing guards, gate tuning)
lives in **northbound-pipeline-engineering**; operating it (triggering scrapes, the cron,
deploy) in **northbound-run-and-operate**.

## (b) Decision digest — 17 ADRs

Authority: `.claude/docs/decisions.md` (append-only, Context→Decision→Rationale→Consequences).
Read the full ADR before relitigating anything below. "Reality check" flags where shipped code
has drifted from the ADR text — the code is the truth for *what is*, the ADR for *why*.

| ADR | Decision | Why it matters today / reality check |
|---|---|---|
| 001 | MongoDB + Mongoose, **FINAL** (not Supabase/Postgres/Prisma) | DB debates are closed. String `YYYY-MM-DD` dates + lexical ranges follow from this (I5). |
| 002 | Agent knowledge under `.claude/` | Docs of record live there. Reality: the `AGENTS.md`/`CLAUDE.md` root files it references no longer exist. |
| 003 | Five MCP servers in `.mcp.json` | mongodb MCP is `--readOnly` **by design** — never remove the flag (prod-DB gate). |
| 004 | Tool-per-source scraping | The framework for source choices. Its Luma-via-Apify pick is superseded by ADR-009. |
| 005 | Dedup fingerprint = sha256(title\|date\|city), time excluded | Invariant I2. Its "merge richest data" consequence was **never implemented** — upserts are blind `$set` (W4). |
| 006 | `add-to-calendar-button-react` for calendar export | Shipped as `components/AddToCalendar.tsx`. Reality: options are Google/Outlook.com/Microsoft365/Apple/iCal — no Yahoo despite the ADR. |
| 007 | Cron → `POST /api/refresh` guarded by `CRON_SECRET` | The only write entry point. Scheduler is GitHub Actions (Vercel Cron only sends GET). No `vercel.json` ever existed; the "cache busting" it mentions was never needed — everything is force-dynamic (I7). |
| 008 | Event schema aggregator extensions (url/source/sourceId/fingerprint/timezone/category…) | Fully applied in `database/event.model.ts`, plus drift: source enum grew to `'hackathon'` (ADR-013 era) then `'watchlist'` (ADR-019, 2026-08-16 — now 7 values total) and the `region` field (ADR-015) that older docs omit. |
| 009 | Luma via free direct `api.lu.ma` JSON (supersedes 004's actor) | Biggest-volume source costs $0 nightly. Unofficial API — if Luma locks it down, fall back to the ADR-004 actor behind the same fetcher interface. |
| 010 | Company = provider-agnostic registry (`COMPANY_SOURCES`) | Adding a company on a known platform is one config line. GDG/Bevy + CNCF skipped on robots.txt etiquette — do not re-add. |
| 011 | Region set: GTA + Ottawa + Montreal + Quebec City | City slugs per source in `lib/fetchers/config.ts`; `CITY_ALIASES` canonicalization feeds the fingerprint (I2). |
| 012 | Pages read Mongo directly in server components (no self-HTTP) | Why `/api/events` has zero in-repo consumers. Its "same filter semantics" comment is now **false** — see W2. |
| 013 | Bespoke company-platform adapters + `CompanyStdEvent` | 9 bespoke adapters, one shared mapper (`mapStdCompanyEvent`). The slug-includes-date rule (I3) originated in this ADR's consequences. |
| 014 | Home hierarchy: official company events first; emit schema.org JSON-LD | Detail pages emit Event JSON-LD; home order is deliberate product structure, not styling. |
| 015 | North-America scope: geo classifier + `region` gate | `classifyRegion` in `lib/fetchers/geo.ts`; INTL dropped pre-upsert (I4). Conservative: only positively-foreign events are dropped. |
| 016 | Home IA: Canada-first, US + Online secondary | Section order on `/`; `region` select leads the FilterBar. |
| 017 | UX lanes (Companies/Hackathons/Local/All) + directory + consumer filter | The lane model. `laneOf()` was *declared* the single source of truth in the ADR; the code took until 2026-08-16 to actually consolidate onto it (W7, now resolved). |

## (c) INVARIANTS — break these and the system corrupts silently

Each is verified in code as of 2026-07-20. Stated with the consequence of violating it.

### I1 — Normalization and slugging happen BEFORE the write
`Event.bulkWrite`/`updateOne` **never fire Mongoose pre-save hooks**. The hook in
`database/event.model.ts` (`EventSchema.pre('save')`) only runs on `.create()`/`.save()` —
i.e. only the orphaned bookings path. That is why `normalizeRawEvent` (database/normalize.ts)
fully normalizes date/time/city/title, and `lib/scrape.ts` derives the slug itself, before
the upsert. **Violation:** any new write path that assumes hooks will normalize stores raw
garbage (UTC-shifted dates, unslugged docs) that no read path can render correctly.

### I2 — The fingerprint recipe is frozen
`buildFingerprint` (database/fingerprint.ts):
`sha256( lower(trim(title)) + '|' + date(YYYY-MM-DD) + '|' + lower(trim(city)) )`.
It is computed on **cleaned** values: after `cleanTitle()` (geo.ts) and after
`canonicalCity()` (normalize.ts `CITY_ALIASES`: Montréal→Montreal, Québec→Quebec City).
`time` is deliberately excluded — sources disagree by minutes for the same event.
**Violation:** changing the recipe, the title cleaning, or the city aliases changes the
fingerprint of every already-stored event → the next scrape inserts a full duplicate set
(this exact mechanism produced the 8 stale pre-normalization Atlas docs — re-scrapes create
new canonical docs instead of correcting old ones. Those docs have since disappeared from
the live DB — 0 matches on 2026-07-20, so the decisions.md "Known follow-ups" entry is
stale, see `northbound-failure-archaeology` A28 — but the mechanism remains the risk).

### I3 — Slug = `generateSlug(title + ' ' + date)`, set only at `$setOnInsert`
`lib/scrape.ts` upsert. Two load-bearing halves:
- **`$setOnInsert` only** → the slug never changes on rescrape → `/events/[slug]` URLs,
  JSON-LD, and shared links stay stable even when a title is edited at the source.
- **Date included** → recurring series (Microsoft Reactor, Figma webinars) reuse titles
  across dates; a bare-title slug hits the unique slug index and silently drops every
  later occurrence as a benign-looking E11000 (a real incident — see
  **northbound-failure-archaeology**).
**Violation:** moving slug into `$set` breaks live URLs; removing the date resurrects the
recurring-series data-loss bug.

### I4 — The region gate drops INTL pre-upsert; ONLINE/UNKNOWN are kept
`normalizeRawEvent` collapses non-North-America to `region:'INTL'`; `lib/scrape.ts` returns
`[]` for those before building the op. Kept on purpose: online events (joinable anywhere)
and `UNKNOWN` (better to show an unclassifiable AWS webinar than silently drop a real NA
event — ADR-015). **Corollary:** rescraping never deletes. If you tighten any gate,
already-stored offenders remain until manually cleaned (a write — needs approval + backup;
see **northbound-run-and-operate** for prod-DB etiquette).

### I5 — `date` and `time` are STRINGS, compared lexically
`date: 'YYYY-MM-DD'`, `time: 'HH:MM'` 24h (schema comments, event.model.ts). Fixed-width
means lexical `$gte/$lte` IS chronological order — every range filter, sort, and the
`todayInToronto()` default depend on it. **Never** put `Date` objects in event queries or
store Date-typed date/time; never parse stored strings back through timezone conversion
(display helpers in `lib/format.ts` use `Date.UTC` parts / string math on purpose — the
UTC-day-shift bug is the founding incident here). "Today" is always Toronto-local:
`todayInToronto()` in lib/events.ts.

### I6 — Every server entry touching Mongoose: `runtime = 'nodejs'` + `await connectDB()` first
All four API routes declare `export const runtime = 'nodejs'` (Mongoose needs the native
TCP driver; Edge cannot run it). `connectDB()` (database/mongodb.ts) is the cached-global
pattern (`bufferCommands:false`, `maxPoolSize:10`, `serverSelectionTimeoutMS:10000`);
`runScrape`'s documented contract is that the caller already awaited it. **Violation:**
Edge runtime fails at import time; skipping connectDB with bufferCommands off throws on
first query.

### I7 — Everything is force-dynamic; there is NO caching layer
All three pages export `dynamic = 'force-dynamic'` (the `[slug]` page is dynamic by param),
all routes too. Zero `revalidate*`/`cacheTag`/`'use cache'` calls exist in app/, lib/, or
components/ (grep-verified 2026-07-20). Freshness is achieved by construction, not
invalidation. **Violation:** adding ISR/`revalidateTag` (which stale legacy skills
prescribe) introduces a staleness axis the system has no machinery to bust — and solves a
problem the app does not have.

### I8 — Any read reachable at build time must be fail-safe (the lib/meta.ts doctrine)
`getScrapeStatus()` renders in the global Footer, so it executes during the build-time
prerender of `/_not-found` — where `MONGODB_URI` may be absent or Atlas unreachable. It
wraps the entire read in try/catch and degrades to "no badge" (commit `2b8c7b9` fixed a
real Vercel build failure). **Rule:** any new component in layout/Footer/Navbar that reads
the DB must catch everything and degrade; a throw there kills `npm run build`.

### I9 — This is a heavily MODIFIED Next.js 16 — bundled docs outrank training data
CONTEXT.md flags it CRITICAL; the docs ship at `node_modules/next/dist/docs/01-app`.
Verified consequences already in code: `params`/`searchParams` are **Promises** (awaited at
the top of every page), GET handlers and `fetch()` are uncached by default, `next lint` is
removed (`npm run lint` runs bare eslint — and currently exits 1; see
**northbound-build-and-env**). Read the bundled docs before writing any route/data-fetching
code; do not trust memory of stock Next 16.

### I10 — Mongoose 9 types and middleware
The installed mongoose 9.6.2 has `QueryFilter` and **zero** occurrences of `FilterQuery`
(verified in node_modules types 2026-07-20; used in lib/events.ts and
app/api/events/route.ts). Middleware takes no `next()` callback — return to continue,
throw to abort (see the pre-save hook comment in event.model.ts). Legacy skills and old
snippets using `FilterQuery` fail typecheck.

### I11 — Field ownership: `enrichment`/`notifiedOpenAt` are excluded from `CanonicalEvent` (ADR-018, 2026-08-16)
`database/normalize.ts` types the scrape-pipeline output as
`CanonicalEvent = Omit<Document, keyof Document | 'slug' | 'fingerprint' | 'createdAt' |
'updatedAt' | 'enrichment' | 'notifiedOpenAt'>`. Because the scrape upsert does
`$set: doc` with `doc` being exactly a `CanonicalEvent`, that `Omit<>` is the **entire
wipe-safety mechanism**: a nightly rescrape can never clobber the enrichment script's
`enrichment` subdoc or the digest's `notifiedOpenAt` marker, because those paths are never
present in the object being `$set`. Verified live: an MLH rescrape modified 55 docs and
every enrichment subdoc survived intact. **Violation:** adding `enrichment` or
`notifiedOpenAt` back into `CanonicalEvent` (e.g. to "simplify" a mapper) silently reopens
the wipe hole — the next scrape erases every enrichment/notification write. Ownership
otherwise: `applicationStatus`/`applicationDeadline` are **scrape-owned** (emitted only by
mappers that truly know them, e.g. Devpost `open_state`); `enrichment` is
**enrichment-script-owned** (`scripts/enrich-hackathons.mjs`, ADR-020); `notifiedOpenAt` is
**digest-owned** (`lib/notify/digest.ts`, ADR-021/022) and only that script may `$unset` it
(the courtesy clear on a real open→closed transition, ADR-022).

## (d) KNOWN-WEAK POINTS — open, stated plainly

Each: what it is → why still open → what NOT to do meanwhile.

### W1 — Production data lives in Atlas database `test`
Both real URIs in `.env.local` end at `mongodb.net/` with **no db path**, so Mongoose
defaulted to `test`. `.env.example` misleads with `/events_site` — that database does not
exist on the cluster (live-verified 2026-07-19: cluster has `sample_mflix, test, admin,
local`; `test` holds events 473 / bookings 0 / meta 1). Why open: renaming requires a data
migration plus a coordinated Vercel env change — a prod-DB write needing gordon's approval.
**Do NOT:** point tooling at `events_site` (you'll see an empty DB and "fix" a non-bug);
"correct" the URI to match `.env.example`; migrate data without explicit approval + backup.
All MCP reads target db `test`.

### W2 — `GET /api/events` divergence from `lib/events.ts` — PARTIALLY RESOLVED 2026-08-16
The route's own comment ("same filter semantics") was stale; the two headline correctness/
leak issues are now fixed (ADR-023 housekeeping): the route's `SOURCES` whitelist now
includes `'hackathon'` AND `'watchlist'` (7 values, matching `lib/events.ts`), and it now
projects out `_id`/`fingerprint`/`sourceId`/`__v` instead of returning raw `.lean()` docs.
The slug-lowercasing inconsistency below is also closed. Remaining open divergence (no
default date floor, no `includeOngoing`, different limit clamps, `category`/`type`
synonym, repeatable `?tag=`) is unchanged — still tracked, still not to be "fixed" without
change control. The **full row-by-row divergence table has ONE home:
`northbound-frontend-engineering` ("API routes as-built")** — read and update it there, not
here.

Formerly-related quirk, now fixed: `GET /api/events/[slug]` and the page path
(`getEventBySlug`) **both** lowercase the slug before lookup as of 2026-08-16 — the
mixed-case-404 inconsistency this section used to flag is closed. **Do NOT:** use the route
as reference for query semantics (lib/events.ts is the behavioral truth for the product);
document it publicly as a stable API; change the remaining semantic divergences without a
decision recorded in decisions.md first.

### W3 — `POST /api/bookings` + the Booking model are orphaned
Zero booking docs ever (live-verified 2026-07-19), zero UI consumers — `RegisterButton` is
an outbound link to the source site; README's API list omits the route. The model carries a
real unique index (`{eventId:1, email:1}` named `uniq_event_email`) and a pre-save hook
that verifies the event exists. It is also the ONLY write path where pre-save hooks
actually run. Why open: undecided whether RSVP is future product surface or tutorial-era
leftover. **Do NOT:** build features on it, delete it, or treat its hook-based flow as
representative of how writes work here (the scrape pipeline is the norm — I1).

### W4 — Cross-source duplicates: last scraper wins, provenance drifts
The upsert `$set`s the WHOLE normalized doc — including `source` — on every match. When
two sources carry the same event (same fingerprint), the last scraper to run overwrites
every field and reassigns `source`; ADR-005's "keep the richest description, prefer the
canonical url" merge policy was never implemented. Why open: possibly acceptable
("freshest wins") but never decided; gotchas.md's sample pattern ($setOnInsert-protected
source) contradicts the code. **Do NOT:** rely on `source` as stable provenance for a
multi-source event, or implement a merge policy ad hoc — that is a pipeline-semantics
change needing an ADR (**northbound-pipeline-engineering** has the mechanics).

### W5 — The slug E11000 silent-drop hole
`lib/scrape.ts` treats ANY bulk E11000 as a benign fingerprint race. But the unique **slug**
index can also throw E11000: two *different* events with the same title AND date in
*different cities* have different fingerprints yet identical slugs (slug = title+date, no
city) — the loser is silently dropped and its counts absorbed. gotchas.md prescribes
discriminating via `err.keyPattern` and suffixing the slug; never implemented. Why open:
low observed frequency, but it is invisible data loss by construction. **Do NOT:** treat
E11000 in scrape logs as always-benign when debugging a missing event (check whether slug
or fingerprint fired — **northbound-debugging-playbook**); widen the E11000 swallow.

### W6 — The function-duration ceiling is contradicted, and UNVERIFIED
Three claims coexist: `.github/workflows/scrape.yml` comments say free sources must stay
inside "Vercel Hobby's ~60 s function cap"; `app/api/refresh/route.ts` sets
`maxDuration = 300`; docs/scheduled-scrape.md says 300 s. Which binds on the actual plan
has never been measured. **Planning assumption: 60 s** — also note the workflow's curl
uses `--max-time 90`, so CI reports failure past 90 s regardless. Consequence: paid
eventbrite/meetup runs (meetup's actor timeout is 280 s) are localhost-only until proven
otherwise. **Do NOT:** schedule anything on the hosted site that needs >60 s, or "fix" the
contradiction by editing numbers without measuring the deployed reality.

### W7 — Lane derivation quintuplication — RESOLVED 2026-08-16
Lane derivation and the accent map used to be spread across 5 sites with no test guarding
them: `laneOf()` in lib/constants.ts, `laneFrom()` in app/events/page.tsx, an inline
ternary in components/FilterBar.tsx, and identical `LANE_ACCENT` maps in
components/EventCard.tsx and components/EventRow.tsx. ADR-017 named `laneOf()` the single
source of truth but the code was never consolidated — until now: `lib/constants.ts` is the
sole owner of both `laneOf()`/`laneFromParams()` and the shared `LANE_ACCENT` map;
`app/events/page.tsx`, `components/FilterBar.tsx`, `components/EventCard.tsx`, and
`components/EventRow.tsx` all import from it, and the four local copies are deleted. Any
future lane-model change now touches one file. Frontend mechanics (consumer list, import
shape): **northbound-frontend-engineering**.

### W8 — No test suite
Zero test files, no test script, no CI build gate (the only workflow is scrape.yml; Next 16's
`next build` does not run ESLint). De-facto gate: `npx tsc --noEmit` (passes clean) —
`npm run lint` currently exits 1 (as of 2026-07-19). Every invariant above is enforced only
by comments and this contract. Adding tests is a live candidate: **northbound-validation-and-qa**.

## When NOT to use this skill

- **Making a change** (classification, gates, approval, ADR discipline) → **northbound-change-control**
- **Something is broken; symptom → cause** → **northbound-debugging-playbook**; full incident
  history → **northbound-failure-archaeology**
- **How each platform exposes data, anti-bot/robots reality, date/tz/geo theory** → **northbound-source-platforms-reference**
- **Editing scrapers/normalization/schema/dedup/config** (the how-to) → **northbound-pipeline-engineering**
- **UI/pages/filters/lanes/perf/design compliance** (the how-to) → **northbound-frontend-engineering**
- **Recreating the environment, env vars** → **northbound-build-and-env**; **running scrapes,
  deploys, cron, prod-DB etiquette** → **northbound-run-and-operate**
- **Measuring health/coverage** → **northbound-diagnostics-and-tooling**; evidence bar and
  acceptance thresholds → **northbound-validation-and-qa**
- **Docs of record, stale-doc fixes, house style** → **northbound-docs-and-writing**
- **Growing local coverage at $0** → **northbound-coverage-campaign**; open research fronts →
  **northbound-research-frontier**; proof recipes → **northbound-proof-and-analysis-toolkit**;
  idea lifecycle → **northbound-research-methodology**

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` (branch main) + commands run
read-only against the repo and the live Atlas cluster (via read-only MCP, 2026-07-19).
Every invariant and weak point above was re-verified in source, not copied from docs.
If a re-verification below disagrees with this skill, the repo wins — update this file.

| Volatile fact | Re-verify with (run from repo root) |
|---|---|
| 7 sources in FETCHERS (incl. `watchlist`, added 2026-08-16) | `grep -n -A8 'const FETCHERS' lib/scrape.ts` |
| Fingerprint recipe unchanged | `sed -n '1,13p' database/fingerprint.ts` |
| Slug at `$setOnInsert`, includes date | `grep -n 'setOnInsert' lib/scrape.ts` |
| INTL gate pre-upsert | `grep -n "region === 'INTL'" lib/scrape.ts` |
| source enum has 7 values (incl. `watchlist`) | `grep -n "enum: \['luma'" database/event.model.ts` |
| `enrichment`/`notifiedOpenAt` still excluded from `CanonicalEvent` (I11 wipe-safety) | `grep -n "CanonicalEvent = Omit" database/normalize.ts` |
| date/time stored as strings | `grep -n 'YYYY-MM-DD\|HH:MM' database/event.model.ts` |
| All pages force-dynamic; no ISR anywhere | `grep -rn "force-dynamic\|revalidate" app lib components --include='*.ts*' \| grep -v node_modules` |
| runtime='nodejs' on all Mongoose routes | `grep -rn "runtime = 'nodejs'" app` |
| API SOURCES matches lib/events.ts (7 values incl. hackathon/watchlist) | `grep -n 'const SOURCES' app/api/events/route.ts lib/events.ts` |
| API projects out _id/fingerprint/sourceId/__v (leak fixed) | `grep -n 'EXCLUDE\|toDoc\|items,' app/api/events/route.ts` |
| API routes still have no in-repo consumers | `grep -rn "fetch(" app components lib --include='*.ts*' \| grep -v fetchers` (no output = still true) |
| maxDuration vs 60 s contradiction | `grep -n maxDuration app/api/refresh/route.ts; grep -n '60 s' .github/workflows/scrape.yml` |
| Lane logic consolidated to lib/constants.ts (no local copies) | `grep -rn 'laneOf\|laneFromParams\|LANE_ACCENT' lib/constants.ts app/events/page.tsx components/FilterBar.tsx components/EventCard.tsx components/EventRow.tsx` (expect only import lines outside lib/constants.ts) |
| Mongoose 9: QueryFilter, no FilterQuery | `grep -c QueryFilter node_modules/mongoose/types/query.d.ts; grep -rc FilterQuery node_modules/mongoose/types/index.d.ts` |
| Bundled Next docs present | `ls node_modules/next/dist/docs/01-app \| head -3` |
| URI still has no db path (data in 'test') | `grep -o 'mongodb.net[^"]*' .env.local` (never print full URI) |
| Live doc counts (473 total, meetup 0 as of 2026-07-19) | MongoDB MCP: `count` on db `test` collection `events` (add `{source:'meetup'}` for the meetup count) |
| bookings still orphaned (0 docs, no UI consumer) | MongoDB MCP `count` on `test.bookings`; `grep -rn 'api/bookings' components app --include='*.tsx'` |
| Still no tests | `grep -n '"test"' package.json; find . -path ./node_modules -prune -o -name '*.test.*' -print` |
| ADR count (17 as of 2026-07-20) | `grep -c '^## ADR-' .claude/docs/decisions.md` |
