---
name: northbound-proof-and-analysis-toolkit
description: First-principles proof recipes for Northbound (this event-aggregator repo) — reverse-engineer an undocumented endpoint, discriminate anti-bot 403s (curl vs Node fetch), prove an Apify billing cap before spending, prove date/timezone correctness with boundary cases, isolate perf/scroll-jank causes one variable at a time, prove build-time reads fail-safe, compute WCAG contrast ratios from the real tokens, and read MongoDB explain() plans against the shipped index set. Load when asked to "prove it" / "verify this claim", when adding or validating a data source or endpoint, or when a 403, wrong-date, billing, contrast, or slow-query question tempts you to eyeball instead of measure.
---

# Northbound Proof & Analysis Toolkit

Eight numbered recipes, each proven against this repo's own history. The house rule:
**prove it, don't just install it** — every claim below was re-verified against the repo
(and live endpoints/DB where marked) on 2026-07-20. When your task matches a recipe,
follow its steps and produce the stated PASSING evidence before shipping.

Hard gates that bound every recipe (details in `northbound-change-control`):
G1 $0 hosting / Apify caps, G2 prod Atlas DB is sacred (MongoDB MCP is `--readOnly`),
G3 PRODUCT.md/DESIGN.md are UI law, G4 gordon-authored commits only.

| # | Recipe | Reach for it when |
|---|--------|-------------------|
| 1 | Endpoint reverse-engineering | Adding/validating a data source; "is there a JSON API behind this page?" |
| 2 | Anti-bot discrimination | curl returns 403/blocked; choosing the cheapest working fetch strategy |
| 3 | Billing-cap proof | Anything that can cost money (Apify actors, new paid tiers) |
| 4 | Date/timezone correctness | Events on the wrong day; a new source's date fields |
| 5 | Performance causal isolation | Jank/lag with multiple candidate causes |
| 6 | Fail-safe-read proof | Any DB/env read reachable from a build-time-rendered component |
| 7 | Contrast/a11y math | Any color/token change; "does this pass AA?" |
| 8 | Query/index analysis | Slow or suspicious queries; new filters; new indexes |

---

## Recipe 1 — Endpoint reverse-engineering

**When:** you suspect a site's UI is fed by an undocumented JSON endpoint that would be
cheaper/cleaner than HTML scraping or a paid actor.

**Steps**
1. Open the target page with DevTools Network (XHR/fetch filter) — in this WSL environment
   there is no Chrome; drive Playwright's bundled Chromium instead (see
   `northbound-diagnostics-and-tooling`). Note candidate request URLs and their query params.
2. **Minimal curl repro**: strip the request to the fewest params that still return data.
   Every removed param is a documented degree of freedom.
3. **Node-fetch parity check**: repeat with `node -e 'fetch(...)'` — curl and Node differ in
   TLS fingerprint and default headers, and Node fetch IS the production runtime. If curl
   fails but Node passes, switch to Recipe 2; do not conclude "blocked".
4. **Shape capture**: save one real response; list the fields the normalizer will need
   (dates, tz, city, id, url). Record which fields are optional/null in practice.
5. **Stability probe**: re-request hours/days apart; diff ids and shapes. **Pin stable
   opaque IDs, never vanity slugs** — slugs are user-claimable namespace.
6. Record the result as an ADR if it changes source strategy (see `northbound-docs-and-writing`).

**Worked example — the api.lu.ma direct API (ADR-009, `.claude/docs/decisions.md`)**
While verifying the Apify Luma actor chosen in ADR-004, probing showed `api.lu.ma` answers
unauthenticated JSON for everything needed — so ADR-009 (2026-06-10) dropped the actor
entirely. The three endpoints, as implemented in `lib/fetchers/luma.ts`
(`fetchLumaEntries` / `discoverEvents` / `calendarEvents`):

```bash
curl -s 'https://api.lu.ma/url?url=toronto'                       # slug → kind: 'discover-place' | 'calendar'
curl -s 'https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=discplace-Cx3JMS6vXKAbhV5&pagination_limit=5'
curl -s 'https://api.lu.ma/calendar/get-items?calendar_api_id=cal-400NOkbFqzrkJNA&period=future&pagination_limit=5'
```

All three re-verified live 2026-07-20 (`url?url=toronto` → `kind:"discover-place"`,
`api_id:"discplace-Cx3JMS6vXKAbhV5"`; the pinned Cohere calendar returns a valid
`{"entries":[...],"has_more":...}` shape).

**The vanity-slug lesson** (`.claude/docs/gotchas.md`, "vanity slugs"): `lu.ma/cohere` was
a squatted coliving community, NOT Cohere AI — nearly added as "Cohere AI". As of
2026-07-20 the same slug resolution has drifted AGAIN: `url?url=cohere` now returns
`{"message":"Redirecting","code":"/user/usr-…"}` (a user page, a kind
`fetchLumaEntries` would throw on). The pinned id `cal-400NOkbFqzrkJNA` still works.
That is the stability probe proving itself: **slug resolutions moved twice in five weeks;
the opaque calendar id never did.** Hence `COMPANY_SOURCES` in `lib/fetchers/config.ts`
pins `calendarApiId` for every Luma company except one seeded slug (`notiontoronto`).

**PASSING proof:** a minimal curl line + Node parity + one captured response shape +
a second capture on a later day with unchanged ids, and any id you persist is opaque
(`cal-…`, `discplace-…`, `api_id`), not a slug.

---

## Recipe 2 — Anti-bot discrimination (the 403 matrix)

**When:** a fetch fails with 403/blocked and you must pick the cheapest strategy that
works — BEFORE reaching for a headless browser (no Northbound source needs one).

**The matrix.** Run the same URL through four clients and read the pattern:

| Client | Discriminates |
|---|---|
| `curl -s -o /dev/null -w '%{http_code}' URL` | baseline |
| curl + browser `User-Agent` | header/UA policy vs deeper blocking |
| `node -e 'fetch(URL).then(r=>console.log(r.status))'` | TLS fingerprint (Node ≠ curl signature) |
| Node fetch + browser UA | the production configuration |

Reading the results:
- **curl 403 in ALL header variants, Node fetch 200** → TLS-fingerprinting CDN. curl is
  not a valid smoke test for that host — ever (`gotchas.md`: "curl is NOT a valid smoke
  test for Tesla or Databricks"). Test with `node`/`npx tsx`, which is also the runtime.
- **Both fail with bot UA, both pass with browser UA** → robots/UA policy. Check
  robots.txt first: if it disallows the path for all agents, the project skips the source
  as an etiquette call (see the GDG/CNCF and Snowflake decisions in ADR-010/ADR-013).
- **Content varies per request** (not a 403 but same family): Google's devsite randomly
  machine-translates; pin `?hl=en` + `accept-language` (`lib/fetchers/companies/google.ts`).
- **4xx with specific code**: read it — Tesla returns **412 when lat/lng are missing**,
  which looks like blocking but is a required-param error.

**UA escalation ladder** (cheapest first): honest bot UA `NorthboundBot/1.0 (+https://github.com/CodeOfGordon)`
(`USER_AGENT` in `lib/fetchers/util.ts`) → neutral `BROWSER_UA` (Chrome/130 string in
`lib/fetchers/companies/shared.ts`, used where robots blanket-block AI-crawler tokens:
NVIDIA, Figma; and for TLS-CDN hosts: Tesla, Databricks) → headless browser (never needed
to date; would be a new ADR).

**Worked example — Tesla/Databricks.** Both sit behind TLS-fingerprinting CDNs
(Akamai / Cloudflare). Re-verified live 2026-07-20 against the exact adapter URL shape
from `lib/fetchers/companies/tesla.ts` (`centroidEvents`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'https://www.tesla.com/en_CA/events/api/events?lat=43.6532&lng=-79.3832&page=1&limit=5'   # → 403
node -e 'fetch("https://www.tesla.com/en_CA/events/api/events?lat=43.6532&lng=-79.3832&page=1&limit=5",{headers:{accept:"application/json","user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}}).then(r=>r.text().then(t=>console.log(r.status,t.slice(0,80))))'   # → 200, JSON with totalEventCount
```

**PASSING proof:** the filled 4-cell matrix for the host, the chosen (cheapest) client
documented in the adapter's header comment, and a robots.txt check recorded. Per-platform
specifics live in `northbound-source-platforms-reference` — don't duplicate them here.

---

## Recipe 3 — Billing-cap proof

**When:** anything that can cost money. G1 applies: get gordon's explicit approval BEFORE
any Apify actor run or new paid surface, and never schedule paid sources.

**Principle: never trust a vendor-side INPUT field to cap spend.** Inputs are advisory —
they are read by the actor's own code, which may ignore them. Find the **platform-level
binding limit**: the knob the BILLING system enforces, not the one the product docs suggest.

**Steps**
1. Identify every cost axis (per-result price, per-start fee, per-GB memory, runtime).
2. For each axis, find the platform-enforced limit. On Apify these are **run options** —
   query params on `POST /v2/acts/{actor}/runs`: `?maxItems=` (hard dataset-item/billing
   cap), `?memory=` (start fee is charged PER GB), `?timeout=` (kills an abandoned run).
3. **Pre-declare expected cost** in writing (formula + number) before the run.
4. Run once at a small cap; **verify actual billing afterward** on the Apify console
   against the prediction. Only then raise the cap — and never schedule it (G1).

**Worked example — the June 2026 meetup incident** (`.claude/docs/gotchas.md`, Apify
section; fix in commit `4d3317d`, 2026-06-10 "Harden Apify client billing: run-option
maxItems cap, explicit memory, server-side timeout"). A 12-URL
`easyapi/meetup-events-scraper` run set `maxItems: 20` as actor INPUT, the actor ignored
it and billed ~10× the request — **~$1.4–2** (gotchas.md logged ~$1.39 / 186+ items; the
Apify run record shows ≈$2.02 / 201 items — canonical dual account:
`northbound-failure-archaeology` A4) — most of the ~$5/mo free credit — leaving
the meetup source never live-verified end-to-end (still open as of 2026-07-20; see
`northbound-failure-archaeology`).

The codified fix, verified in `lib/fetchers/apify.ts` (`runActor` / `RunOptions`):
- `?maxItems=` always set for pay-per-result actors — "HARD billing cap … the actor's
  `maxItems` INPUT field is advisory only" (comment in the file);
- `?memory=` explicit — `lib/fetchers/meetup.ts` passes `memoryMb: 2048` (peak observed
  ~1.3 GB; the 4 GB default doubles the $0.09/GB start fee), `timeoutMs: 280_000`;
  `lib/fetchers/eventbrite.ts` passes `memoryMb: 1024` and splits the cap
  `perCity = max(5, floor(MAX_ITEMS / EVENTBRITE_CITIES.length))`;
- server-side `?timeout=` mirrors the poll deadline (`ceil(timeoutMs/1000)+30`) so an
  abandoned client poll cannot leave a run billing;
- token via `Authorization: Bearer` header only, never `?token=` (leaks into logs).

**PASSING proof:** written cost prediction → one capped run → console-verified actual ≤
prediction → cap raised only with approval. A run with no `?maxItems=` run option is an
automatic FAIL regardless of what the input JSON says. Operating protocol for actually
triggering paid runs: `northbound-run-and-operate`.

---

## Recipe 4 — Date/timezone correctness

**When:** wiring a new source's date fields, or events appear on the wrong day.

**The two load-bearing patterns** (both in `database/normalize.ts`):
1. **Wall-clock extraction, never UTC truncation.** For a real instant + IANA zone,
   extract parts via `Intl.DateTimeFormat('en-CA', { timeZone, …, hourCycle: 'h23' })`
   (`partsInZone`, used by `normalizeDate`/`normalizeTime`). `new Date(x).toISOString().split('T')[0]`
   is the bug pattern — it converts to UTC first.
2. **Date-only strings stay local.** `"June 15, 2026"` parses as LOCAL midnight; read it
   back with local getters (`getFullYear()`…). Running a date-only value through a zone
   conversion is itself what shifts the day (comment at `normalizeDate`).

**Classify every new source's date fields before mapping them:**

| Kind | Example in this repo | Correct handling |
|---|---|---|
| True UTC instant + per-event IANA zone | Luma `start_at` + `timezone` | `normalizeDate(start_at, timezone)` |
| True UTC instant, NO per-event zone | MLH `startsAt` (converted in `DEFAULT_TZ` America/Toronto — the `case 'mlh'` mapper); Microsoft Reactor (rendered as UTC wall-clock, documented gotcha) | pick and document ONE zone assumption |
| **Faux-UTC** (local date encoded at `T00:00:00+00:00`) | Tesla `dates[].startDate` | `slice(0, 10)` ONLY — never treat as instant (`localDate` in `lib/fetchers/companies/tesla.ts`; real clock time exists only in the human `hours` string) |
| Loose/date-only string | NVIDIA (`parseLooseUSDate`, skips `'TBC'`); `"June 15, 2026"` anywhere | local getters, no zone math |
| Year-less string (`"12 JUN"`) | Snowflake | resolve to next occurrence (`snowflake.ts`) |

**Worked example — the normalizeDate UTC-shift bug.** Evening Toronto events appeared on
the NEXT day: Luma sends UTC instants, and a naive UTC date-split rolls an 8 PM EDT event
past midnight UTC. Documented as debt in commit `3458ad6` (2026-06-09, gotchas entry),
fixed in `58d715e` (2026-06-10, the fetcher implementation that rewrote
`database/normalize.ts`); `gotchas.md` carries the closure header "normalizeDate UTC-shift
bug — FIXED (2026-06-10)". The model's pre-save hook reuses the same helpers — but note
pre-save hooks never run on the scraper's `bulkWrite` path (see
`northbound-architecture-contract`), so the normalizer must be right on its own.

**PASSING proof — run the boundary battery** (re-run live 2026-07-20; `npx tsx -e`
resolves the repo's `@/` imports):

```bash
npx tsx -e "
import { normalizeDate, normalizeTime } from './database/normalize';
console.log(normalizeDate('2026-08-02T01:30:00Z','America/Toronto'));  // 2026-08-01  (UTC-truncation would say 2026-08-02)
console.log(normalizeTime('2026-08-02T01:30:00Z','America/Toronto'));  // 21:30
console.log(normalizeDate('June 15, 2026'));                            // 2026-06-15  (local getters, no zone shift)
console.log(normalizeDate('2026-06-21T00:00:00+00:00'.slice(0,10)));    // 2026-06-21  (faux-UTC handled as date-only)
"
```

A passing battery covers at least: one midnight-adjacent instant (UTC date ≠ local date),
one date-only string, one faux-UTC value, and one DST-transition date for the source's zone.

---

## Recipe 5 — Performance causal isolation

**When:** UI feels janky/slow and multiple mechanisms could be responsible.

**Principle:** change ONE compositor/render variable at a time and measure — frame timings
and traces, not eyeball. A "smoothness enhancement" is a suspect like any other; three of
this repo's jank causes were shipped AS perf/polish features.

**Worked example — the scroll-jank bisection (2026-06-20/21).** The commit-by-commit
chronicle has ONE home: `northbound-failure-archaeology` A23 (six commits
`3791db0`→`63a965a`, all hashes verified via `git log`/`git show`) — read the full table
there. What matters for THIS recipe is the isolation structure: three suspects were shipped
as perf/polish enhancements (`3791db0` content-visibility utilities, `ded4973`
scroll-reveal + React-state image fade, `0b21f84` Lenis + shimmer); the cure was three
removal commits — `6a886a4` (an image/render-churn CLUSTER: weserv width-capped WebP +
drop cv-* + drop reveal), `40b8c19` (exactly one variable: React-state fade → DOM-only
`element.style.opacity`), `63a965a` (exactly one variable class: compositor
`backdrop-filter`/`blur` removal).

What each isolation established: residual jank after `6a886a4` proved images weren't the
sole cause; residual stutter after `40b8c19` proved re-renders weren't either; `63a965a`
ended it, pinning the remaining cost on per-frame filter compositing. Honest caveat:
`6a886a4` bundled three related suspects (pragmatic, but it means their individual
contributions were never separated — don't cite this repo as proof that any ONE of them
was harmless).

**Traps this history leaves behind** (do not resurrect; full chronicle in
`northbound-failure-archaeology`): `.reveal`, `.skeleton-overlay`, and `cv-*` are still
DEFINED in `app/globals.css` with zero consumers, and `components/SmoothScroll.tsx` has a
stale comment claiming reveal animations still work.

**PASSING proof:** a before/after trace pair per single change — use the chrome-devtools
MCP `performance_start_trace`/`performance_stop_trace` where Chrome is available; in this
WSL environment drive Playwright's bundled Chromium (`northbound-diagnostics-and-tooling`
has the tooling runbook; `northbound-frontend-engineering` owns the resulting perf
conventions). Compare long-task counts and frame times, and state which single variable
changed between the two traces.

---

## Recipe 6 — Fail-safe-read proof

**When:** any data read reachable from a component that renders at BUILD time (anything in
the root layout — Navbar, Footer — renders on every page including statically prerendered
ones like `/_not-found`).

**Rule:** a build-reachable read must be provably non-throwing under (a) missing env var,
(b) unreachable DB, (c) empty DB. Pattern: `try/catch` at the data-layer function + a
typed degraded fallback + `console.warn` (never rethrow) + UI that renders nothing rather
than something wrong.

**Worked example — the /_not-found prerender crash** (commit `2b8c7b9`, 2026-06-20 "Fix
Vercel build: make the freshness read fail-safe on /_not-found"). The global Footer's
freshness read ran during static prerender of `/_not-found`, where `MONGODB_URI` may be
absent or Atlas unreachable — the Vercel build failed. The fix, verified in
`lib/meta.ts` `getScrapeStatus()`: whole body in `try/catch`, degrading through three
levels — `basis:'tracked'` (the `scrape` meta doc) → `basis:'derived'` (newest
`Event.updatedAt`) → `EMPTY` (`{ lastRunAt: null, perSource: {}, basis: 'none' }`) — with
the rationale spelled out in the in-function comment.

**PASSING proof** (falsification test — run from repo root):

```bash
mv .env.local /tmp/nb-env-backup && npm run build; mv /tmp/nb-env-backup .env.local
```

The build must SUCCEED, emitting the `getScrapeStatus: unavailable —` warning instead of
crashing. Any new read added to layout-level components must pass the same test before
merge. (`npm run build` with env present is the regression test for the original crash.)

---

## Recipe 7 — Contrast / a11y math

**When:** any color or token change, or any "does this pass?" question. G3: PRODUCT.md
sets a WCAG 2.2 AA floor (≥ 4.5:1 normal text; 3:1 for large text and UI components) and
DESIGN.md's tokens are law — compute, never eyeball.

**The tool** (WCAG relative-luminance ratio; run as-is):

```bash
node -e '
function lum(h){const c=h.replace("#","");const v=[0,2,4].map(i=>parseInt(c.slice(i,i+2),16)/255).map(x=>x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4));return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];}
function ratio(a,b){const[l1,l2]=[lum(a),lum(b)].sort((x,y)=>y-x);return((l1+0.05)/(l2+0.05)).toFixed(2);}
console.log(ratio(process.argv[1],process.argv[2]));' '#888f9d' '#0a0b0d'
```

**The numbers for the shipped tokens** (`app/globals.css` `:root`; computed 2026-07-20):

| Foreground | On `#0a0b0d` (bg) | On `#121419` (dark-100 card) | On `#1e222b` (dark-200 raised) | AA 4.5:1? |
|---|---|---|---|---|
| `--color-light-200` `#888f9d` (muted/meta) | **6.06** | **5.67** | **4.90** | passes everywhere — thinnest margin 0.40 on dark-200 |
| `--foreground` `#f4f5f6` | 18.04 | — | — | pass |
| `--color-light-100` `#e4e6ea` | — | 14.74 | — | pass |
| mint `#59deca` | 11.93 | 11.17 | — | pass (and ink `#04110e` on mint CTA = 11.66) |
| amber `#fcd34d` | 13.65 | 12.78 | — | pass |
| blue `#8fd9ff` | 12.69 | — | — | pass |

**Worked example — DESIGN.md's own a11y-watch flag, falsified in one direction.**
DESIGN.md ("A11y watch") claims `#888f9d` on `#0a0b0d` "sits near the AA 4.5:1 line" and
"on lighter card surfaces … drops below". The math says: direction right (light-200 IS the
weakest pair and dark-200 IS its worst surface), **number wrong** — 4.90:1 still passes.
The doc's caution would have triggered unnecessary token churn (a G3 sign-off cycle); the
computation both cleared the token AND quantified how thin the margin is: any lightening
of `dark-200` or darkening of `light-200` breaks AA. Proof beats eyeball in both
directions — it catches false alarms as well as real failures.

**PASSING proof:** the computed ratio for every changed fg/bg pair, at the correct
threshold (4.5 normal text / 3.0 large text ≥ 24px or ≥ ~18.7px bold / 3.0 non-text UI per
WCAG 1.4.11), pasted into the PR/ADR. Token-change process itself: `northbound-frontend-engineering`.

---

## Recipe 8 — Query / index analysis

**When:** adding a filter or index, or a query seems slow/wrong.

**Tooling:** the MongoDB MCP server (configured `--readOnly` in `.mcp.json` — G2 compliant;
explain/indexes/find are fine, writes are impossible). **Trap: prod data lives in database
`test`** (namespace `test.events`) — pass `database: "test"`, `collection: "events"` to
`mcp__mongodb__explain` / `mcp__mongodb__collection-indexes`.

**The shipped index set** (`database/event.model.ts`; live-confirmed identical on Atlas
2026-07-20 — 9 indexes): `_id`, `slug_1` (unique via field option — deliberately NOT
re-declared as a schema index, see the comment), `fingerprint_1` (unique+sparse),
`mode_1_date_1`, `city_1_date_1`, `tags_1_date_1`, `region_1_date_1`, `date_1__id_1`, and
an unweighted text index on title/description/tags.

**The $text/$or rule.** MongoDB rejects the combination `queryEvents` would otherwise
produce: a top-level `$text` alongside the includeOngoing `$or`
(`[{date:{$gte:from}},{endDate:{$gte:from}}]`). `lib/events.ts` routes around it —
`const includeOngoing = !q && (params.includeOngoing ?? params.category === 'hackathon')`
— i.e. **any active search silently disables ongoing-inclusion** (acceptable: search is
relevance-sorted, per the in-code comment). Related shape: with a `to` bound the `$or`
nests under `$and` so the two date constraints don't collide on the `date` key. Don't
"fix" either without reading that comment block; `/api/events` mirrors the same semantics.

**Worked examples — two live explains (Atlas, 2026-07-20, verbosity executionStats):**

1. *Passing:* `find {region:'CA', date:{$gte:'2026-07-20'}} sort {date:1,_id:1} limit 18`
   → winning plan IXSCAN on `region_1_date_1`, tight bounds (`region:["CA","CA"]`,
   `date:["2026-07-20",{})`), keysExamined 28 / docsExamined 28 / nReturned 18, 0 ms.
   Nuance worth knowing: a bounded in-memory SORT stage still appears, because the index
   yields date order but not the `_id` tiebreak — fine at this scale (limit-18,
   memLimit 32 MB), a thing to re-check if the collection grows 100×.
2. *Instructive miss:* `find {city:{$regex:'^Toronto$',$options:'i'}, date:{$gte:…}}`
   (exactly what `queryEvents` builds for the city filter) → the planner REJECTS
   `city_1_date_1`: the case-insensitive regex forces unbounded city bounds `["",{})`, so
   the winning plan is `date_1__id_1` + FETCH-filter — keysExamined 119 for nReturned 18
   (6.6:1 waste). Harmless today; the measured shape of a future problem. Candidate fixes
   (NOT implemented as of 2026-07-20 — canonicalize city case at write time, or a
   collation-backed index) belong in an ADR first.

**PASSING proof:** explain shows IXSCAN (not COLLSCAN) on the intended index with tight
bounds; keysExamined ≈ nReturned within a small factor; no unbounded blocking SORT; for
search queries, a TEXT_MATCH stage. Paste the winning-plan summary (stage, indexName,
keysExamined/nReturned) into the PR. Index/schema changes themselves follow
`northbound-pipeline-engineering` + `northbound-change-control`.

---

## When NOT to use this skill

- **Making the change after the proof** — scrapers/normalization/schema/dedup:
  `northbound-pipeline-engineering`; UI/API surface: `northbound-frontend-engineering`.
- **A misbehaving system with a known symptom** (0 items, E11000, wrong day, 403…):
  start at `northbound-debugging-playbook`; this skill supplies the proof techniques it calls for.
- **"Has this been tried before?" / dead code and dead ends**: `northbound-failure-archaeology`.
- **Per-platform endpoint/anti-bot facts** (Luma, Tesla, MLH, Devpost…): `northbound-source-platforms-reference` is the reference; recipes 1–2 here are the method.
- **Running scrapes, cron, deploys, paid-source protocol**: `northbound-run-and-operate`.
- **Shipped measurement scripts and their interpretation**: `northbound-diagnostics-and-tooling`.
- **Whether a change is allowed at all / needs approval or an ADR**: `northbound-change-control`.
- **The evidence bar and experiment lifecycle for uncertain hypotheses**: `northbound-research-methodology`; acceptance thresholds: `northbound-validation-and-qa`.
- **Invariants you must not break while proving things**: `northbound-architecture-contract`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` (branch main) + commands run
live against the repo, api.lu.ma, tesla.com, and the Atlas cluster (read-only). All git
citations verified via `git log`/`git show`; all code citations re-read in the named files.

| Volatile fact (as of 2026-07-20) | Re-verify with |
|---|---|
| `api.lu.ma/url?url=toronto` → `discover-place` / `discplace-Cx3JMS6vXKAbhV5` | `curl -s 'https://api.lu.ma/url?url=toronto' \| head -c 120` |
| Cohere pin `cal-400NOkbFqzrkJNA` returns valid entries shape | `curl -s 'https://api.lu.ma/calendar/get-items?calendar_api_id=cal-400NOkbFqzrkJNA&period=future&pagination_limit=1' \| head -c 120` |
| Tesla: curl 403 / Node fetch+browser-UA 200 | `curl -s -o /dev/null -w '%{http_code}\n' 'https://www.tesla.com/en_CA/events/api/events?lat=43.6532&lng=-79.3832&page=1&limit=5'` |
| Apify guards: `?maxItems=`/`?memory=`/`?timeout=` set in runActor | `grep -n "params.set('maxItems'" lib/fetchers/apify.ts` |
| meetup run params 2048 MB / 280 s | `grep -n 'memoryMb' lib/fetchers/meetup.ts lib/fetchers/eventbrite.ts` |
| normalizeDate boundary battery passes | the `npx tsx -e` block in Recipe 4 |
| getScrapeStatus try/catch + EMPTY fallback intact | `grep -n 'catch' lib/meta.ts` |
| `.glass` still solid (no backdrop-filter) | `grep -n -A2 '@utility glass' app/globals.css` |
| Token hexes unchanged (contrast table valid) | `grep -n -E '0a0b0d\|121419\|1e222b\|888f9d\|59deca\|fcd34d' app/globals.css` |
| 9 indexes on Atlas match event.model.ts | MCP `mcp__mongodb__collection-indexes` `{database:'test', collection:'events'}` |
| $text/$or routing still `!q &&` gated | `grep -n 'includeOngoing = ' lib/events.ts` |
| city regex still misses `city_1_date_1` (keysExamined ≫ nReturned) | MCP `mcp__mongodb__explain` with the Recipe 8 example-2 filter |
| Meetup source still never live-verified end-to-end | `.claude/docs/CONTEXT.md` open items + ask gordon before spending credit (G1) |
