---
name: northbound-validation-and-qa
description: Northbound's evidence bar, acceptance thresholds, and QA reality — what "live-verified" means, the per-source/per-adapter verification inventory (why meetup has 0 docs ever), the before/after source-health acceptance procedure for pipeline changes, the DESIGN.md UI acceptance checklist with measured contrast numbers, the honest test-suite state (none exists; tsc is the gate, lint is red), the db-sanity golden invariants, and the CANDIDATE plan for adding vitest characterization tests. Load when asked "is this change acceptable", "how do I validate/test this", "is source X actually working", "add tests", or before claiming anything in Northbound works.
---

# Northbound validation and QA

Northbound = the event-aggregator repo you are in (Next.js 16 App Router + Mongoose 9 on
Atlas; six scrape sources; nightly GitHub Actions cron). This skill defines **what counts
as evidence**, **what gates a change**, and **the honest current QA state**. Hard gates
G1–G4 (money, prod DB, design law, commit authorship) are defined in
`northbound-change-control` — nothing below overrides them.

## 1. The evidence bar

**A source or adapter is "live-verified" only when ALL of these hold:**

1. It was hit **from Node in this repo** (the pipeline path or an `npx tsx` script
   importing the real fetcher) — not curl (Tesla/Databricks 403 curl but pass Node fetch;
   see `.claude/docs/gotchas.md`), not a browser, not "the API docs say".
2. **N > 0 items came out normalized end-to-end** — through `normalizeRawEvent()`
   (`database/normalize.ts`) and, for full verification, upserted by `runScrape()`
   (`lib/scrape.ts`) so docs exist in the live DB with `fingerprint`, `region`, `slug`.
3. The run is **date-stamped** — in the `meta` collection's `perSource` timestamps, in a
   doc's `updatedAt`, or in a written note with the date.

**"It should work" is not evidence.** Neither is "the code looks right", "the types
check", or "the docs describe it". This discipline exists because this repo was burned by
exactly that failure: the 9 legacy skills under `.claude/skills/` (frontend, scheduling,
database, backend-api, event-scraping, …) were written **before** the implementation and
stated unbuilt plans as fact — `frontend/SKILL.md` prescribed SWR (never installed; grep
`package.json`), `scheduling/SKILL.md` prescribed a `vercel.json` cron (never existed),
`backend-api/SKILL.md` used Mongoose `FilterQuery` (removed in Mongoose 9; the code uses
`QueryFilter`). All 9 were retired as RETIRED tombstones on 2026-07-20 —
`frontend/SKILL.md`'s stale body was removed (original recoverable via
`git show 0c493c9:.claude/skills/frontend/SKILL.md`). Never cite those skills as
authority; the `northbound-*` library replaces them.

Corollaries:

- **Absence of docs is evidence of absence of verification, not of breakage.** A registry
  company with 0 docs may have an empty calendar. Distinguishing "empty feed" from
  "broken adapter" requires a supervised fetch run, not DB inspection.
- **Code that has never produced a live doc is UNVERIFIED CODE** no matter how reviewed it
  is. `lib/fetchers/meetup.ts` is the standing example (§2).
- When you verify something, **date-stamp it** where the next session will look: the
  inventory below, or `.claude/docs/gotchas.md` / an ADR via `northbound-docs-and-writing`.

## 2. Live-verified inventory

Doc counts re-measured 2026-07-20 by running `source-health.mjs` (command in §3) against
the live Atlas DB (db name `test` — that is production, see `northbound-build-and-env`).
**Do not trust these numbers in a future session — re-derive them**; only the
*method/status* columns are durable.

| Source | Docs (2026-07-20) | Upcoming | Newest `updatedAt` | Status |
|---|---|---|---|---|
| `luma` | 33 | 5 | 2026-07-19 | **Live-verified**, refreshed by the nightly cron (last clean run 2026-07-19 09:15 UTC, `lastErrors: []`) |
| `eventbrite` | 29 | 5 | **2026-06-10** | Live-verified **once** (June 2026 Apify run). All docs June-era and aging out of the upcoming window. Paid — re-running needs G1 approval |
| `meetup` | **0 — ever** | 0 | — | **UNVERIFIED CODE.** The actor ran once (2026-06), billed ~10× its request (~$1.4–2; run-record numbers: `northbound-failure-archaeology` A4), and **no doc ever landed**. Item shape was inspected but the pipeline never completed. Treat `lib/fetchers/meetup.ts` as untested until a supervised approved run writes docs. History: `northbound-failure-archaeology` |
| `mlh` | 17 | 11 | 2026-07-19 | Live-verified, on the nightly cron |
| `company` | 255 | 96 | 2026-07-19 | Live-verified, on the nightly cron (per-adapter detail below) |
| `hackathon` | 139 | 5 | 2026-07-19 | Live-verified, on the nightly cron (aggregates Devpost, lu.ma discover, DoraHacks, ETHGlobal) |

Total 473 docs / 122 upcoming as of 2026-07-20. `meta.perSource` has entries **only** for
luma/mlh/hackathon/company — eventbrite/meetup have never run since meta bookkeeping began
(2026-06-21).

**Per company adapter** (the `company` source fans a 38-entry registry in
`lib/fetchers/config.ts` `COMPANY_SOURCES` onto 11 providers — see
`northbound-source-platforms-reference`). Measured 2026-07-20 by aggregating
`{source:'company'}` docs by `organizer`:

- **Live-DB evidence exists (30 of 38 registry entries):** bespoke adapters `reactor` (41
  docs), `aws` (19), `nvidia` (16), `databricks` (11), `snowflake` (3), `figma` (5),
  `google` (1), `yc` (1); `tribe` (Vector Institute, 7); the generic `luma` provider for
  Google DeepMind (29), Cursor (21), Pinecone (14), Raycast (11), PostHog (10), LangChain
  (9), Modal (8), MotherDuck (8), and 13 more.
- **Zero docs, by design (1):** Tesla — the `devOnly` relevance gate (ADR-017,
  `lib/scrape.ts`) intentionally filters its consumer feed to nothing; 0 is correct.
- **Zero docs, undetermined (7):** Cohere, Hugging Face, Vercel, Perplexity, ElevenLabs,
  Linear, Notion Toronto — all `luma`-provider calendar entries. Empty calendar vs
  stale/wrong `calendarApiId` is **not determinable from the DB**; verifying needs a
  supervised fetch of that calendar (free, no G1 issue). Until then: undetermined, not
  broken, not verified.

Re-derive the per-company table any time (read-only):

```bash
node --env-file=.env.local --input-type=module -e "
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
const rows = await mongoose.connection.db.collection('events').aggregate([
  { \$match: { source: 'company' } },
  { \$group: { _id: '\$organizer', docs: { \$sum: 1 }, newest: { \$max: '\$updatedAt' } } },
  { \$sort: { docs: -1 } }]).toArray();
rows.forEach(r => console.log(r._id, r.docs, r.newest?.toISOString().slice(0,10)));
await mongoose.disconnect();"
```

(`--input-type=module -e` resolves `mongoose` from the repo cwd; a script file outside the
repo will fail with `ERR_MODULE_NOT_FOUND`.)

## 3. Acceptance thresholds for pipeline changes

Any change to `lib/scrape.ts`, `lib/fetchers/*`, `database/*` (how to make the change:
`northbound-pipeline-engineering`; how to trigger scrapes: `northbound-run-and-operate`).

**Procedure — before/after with the shipped instrument** (script details and
interpretation: `northbound-diagnostics-and-tooling`):

```bash
# BEFORE the change (save the output):
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs
# ... make the change, run a scrape of the affected source(s) (free sources only
# without approval — paid eventbrite/meetup runs are G1-gated) ...
# AFTER:
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/db-sanity.mjs
npx tsc --noEmit
```

**A pipeline change is acceptable only if ALL of these hold:**

| # | Threshold | How to check |
|---|---|---|
| 1 | Target source's doc count is in its expected band | Docs can only grow (upserts never delete): `after ≥ before`, and new upserts per run ≤ `SCRAPE_MAX_ITEMS` (default 50) per fan-out unit (per city/provider/season page). A jump far beyond that, or `after = before` when you expected inserts, both fail |
| 2 | **Zero `region:'INTL'` docs** | `db-sanity.mjs` check 3 (the ADR-015 geo gate must have dropped them pre-upsert) |
| 3 | **No regression in other sources' counts** | Sources you did not scrape must be byte-identical to the before snapshot; sources you did scrape must not lose docs |
| 4 | **No new `lastErrors`** across a full refresh of the affected sources | `source-health.mjs` prints the `meta` singleton; `lastErrors` must be `[] (clean)` after the run |
| 5 | **`npx tsc --noEmit` exits 0** | The only mechanical gate that is green today (§5) |
| 6 | **`db-sanity.mjs` exits 0** | The golden invariants (§7) |

Also eyeball `upcoming` (the product-meaningful number — 473 docs with only 122 upcoming
means raw count alone flatters). If a change is meant to improve coverage, judge it with
`coverage-report.mjs` per `northbound-coverage-campaign`.

## 4. UI acceptance under G3

`PRODUCT.md` and `DESIGN.md` are law for anything UI (G3). Deviations need gordon's
sign-off. Full frontend runbook: `northbound-frontend-engineering`. Before calling UI
work done:

**Design-compliance checklist (against `DESIGN.md`):**

- [ ] Dark-only. No light-mode styles, no theme toggle.
- [ ] Only token colors (`app/globals.css` `:root`): surfaces `#0a0b0d`/`#121419`/`#1e222b`,
      text `#f4f5f6`/`#e4e6ea`/`#888f9d`, accents mint `#59deca` / amber `#fcd34d` /
      blue `#8fd9ff`. No new hex values without sign-off.
- [ ] **Amber is company-only.** `--color-amber` marks "official company event" (lane dot,
      hover border, stale-freshness dot) and nothing else. Any new amber use fails review.
- [ ] Lane accent = small dot + hover-border tint. Never a colored side-stripe.
- [ ] Anti-patterns absent (DESIGN.md "Anti-patterns avoided"): no nested cards, no new
      glassmorphism/backdrop-blur, no bounce easing, no over-rounding (>16px on cards),
      no numbered-section scaffolding, no new gradient text (the hero `.text-gradient` is
      the single sanctioned instance).
- [ ] Fonts stay Schibsted Grotesk (display/UI) + Martian Mono (meta) via `next/font/google`.

**Contrast spot-check** — the light-200 watchpoint. Measured 2026-07-20 (WCAG relative
luminance; AA floor for body text is 4.5:1 per PRODUCT.md):

| Usage | Ratio | Verdict |
|---|---|---|
| `light-200` `#888f9d` solid on `#0a0b0d` | 6.06 | pass |
| `light-200` solid on `dark-100` `#121419` | 5.67 | pass |
| `light-200` solid on `dark-200` `#1e222b` | 4.90 | pass (thin margin) |
| `text-light-200/80` on background (Footer.tsx) | **4.23** | **below AA** — existing debt, do not replicate |
| `placeholder:text-light-200/60` on `dark-100` (SearchBox.tsx) | **2.82** | below AA (placeholder; still avoid) |
| `text-light-200/40` disabled (Pagination.tsx) | — | exempt (disabled state) |

Rule: **solid `light-200` is safe on all shipped surfaces; opacity-modified `light-200`
body text is not.** New muted text: use the solid token. (Note DESIGN.md's own prose
claims solid light-200 "drops below" AA on cards — measurement says it does not; the real
gap is the opacity modifiers. Fixing that prose: `northbound-docs-and-writing`.)

**Screenshots at 2–3 viewports** — WSL has no Chrome; use the shipped Playwright-Chromium
script against a running dev server (`npx playwright install chromium` once):

```bash
S=.claude/skills/northbound-diagnostics-and-tooling/scripts/screenshot.mjs
mkdir -p .screenshots   # screenshot.mjs does not create the output directory
node $S http://localhost:3000/events .screenshots/ev-mobile.png 390 844
node $S http://localhost:3000/events .screenshots/ev-tablet.png 768 1024
node $S http://localhost:3000/events .screenshots/ev-desktop.png 1440 900 --full
```

(`.screenshots/` is an untracked scratch dir — never commit the PNGs.)

Read the PNGs and check: no horizontal overflow, popovers/filters inside the viewport,
timeline date rail behavior at `sm:`, images loading (weserv proxy).

**Reduced motion honored** — the shipped pattern is: Lenis smooth-scroll bails entirely
via `window.matchMedia('(prefers-reduced-motion: reduce)')` (`components/SmoothScroll.tsx`)
and image fades carry `motion-reduce:transition-none` (`components/EventImage.tsx`). Any
new animation must have an equivalent guard. Check: `grep -rn "motion-reduce\|prefers-reduced-motion" components app`.

**Perf-convention regression grep** — the scroll-jank saga (commits `ded4973`→`63a965a`,
chronicle in `northbound-failure-archaeology`) settled hard conventions. Run these; the
expected baselines are exact as of 2026-07-20:

```bash
# 1. No backdrop-filter/backdrop-blur anywhere in app code.
grep -rn "backdrop" app components --include='*.tsx' --include='*.css'
#    EXPECTED: only the explanatory comment in app/globals.css (.glass is deliberately SOLID).
# 2. No content-visibility on rendered elements.
grep -rn "content-visibility" app components; grep -rn "cv-card\|cv-row" app components --include='*.tsx'
#    EXPECTED: the dead cv-card/cv-row @utility defs in globals.css; ZERO .tsx consumers.
# 3. Image fade stays DOM-only — onLoad mutates style.opacity, never setState.
grep -n "onLoad\|setStage\|style.opacity" components/EventImage.tsx
#    EXPECTED: onLoad → e.currentTarget.style.opacity = '1'; useState exists ONLY for the
#    proxy→original→failed fallback stage, never for the fade.
```

New hits beyond these baselines = regression; revert or get sign-off.

## 5. The honest current state (no test suite)

As of 2026-07-20, all re-verified by running the commands:

- **There is no test suite.** Zero `*.test.*` / `*.spec.*` files; no
  `vitest.config.*` / `jest.config.*` / `playwright.config.*`. `package.json` has exactly
  four scripts: `dev`, `build`, `start`, `lint` — no `test`.
- **`playwright` (^1.60.0, devDependencies) is NOT an e2e suite.** It is never imported by
  any app source file; it exists solely as the bundled-Chromium runtime for agent tooling
  (`screenshot.mjs` above, and `.mcp.json` runs the separate `@playwright/mcp` package).
  Do not report "the project has Playwright tests".
- **The mechanical gate is `npx tsc --noEmit`** — exit 0, ~7 s, re-verified 2026-07-20.
  Note Next 16's `next build` no longer runs ESLint, and there is no CI beyond
  `scrape.yml`, so tsc + the Vercel deploy build are the only automated checks.
- **`npm run lint` is RED by known baseline** — exit 1, re-verified 2026-07-20. One real
  error (`react-hooks/purity` — `Date.now()` during render in
  `components/FreshnessBadge.tsx`) plus a warning bulk from untracked `.claude/` scripts
  that `eslint.config.mjs` does not ignore. Do not treat exit 1 as your failure; current
  counts, causes, and the fresh-clone caveat live in `northbound-build-and-env`.
  **Do not "fix lint" as a drive-by** — the fix choices (effect vs suppress;
  adding `.claude/**` to `globalIgnores`) are routed through `northbound-change-control`.
  Never claim "lint passes" and never gate your change on lint going green.

So today, "validated" for a code change means: **tsc green + the §3 or §4 acceptance
checks + no new lint errors beyond the known baseline** (compare error/warning counts,
don't demand zero).

## 6. How to add tests — CANDIDATE, not adopted policy

Nothing below is decided. Adding a test runner is a **new devDependency + a new `test`
script = dependency-gated**: route through `northbound-change-control` and get approval
before `npm install` anything. Written 2026-07-20 as the recommended shape when approved.

**Highest-value first tests: zero-infra characterization tests over pure functions.** No
DB, no network, no browser — they pin today's verified behavior so refactors can't
silently change it:

| Target (all verified exported, 2026-07-20) | Why first |
|---|---|
| `normalizeRawEvent(raw, source)` — `database/normalize.ts` | THE mapper. Per-source mappers (`mapLumaEvent`, `mapStdCompanyEvent`, the `mapRaw` switch) are **private** — test through this exported entry with one captured raw fixture per source |
| `normalizeDate` / `normalizeTime` — `database/normalize.ts` | Regression-pins the evening-events-shift-a-day UTC bug (fixed 2026-06-10; see `northbound-failure-archaeology`): a Toronto 8 pm UTC instant must normalize to the local date |
| `buildFingerprint` — `database/fingerprint.ts` | The dedup identity: sha256 of `lower(title)|date|lower(city)`, time excluded. Any drift orphans 473 live fingerprints |
| `classifyRegion` / `cleanTitle` — `lib/fetchers/geo.ts` | The INTL gate. Pin the sharp edges: bare `'London'` → INTL(UK), `'London, ON'` → CA, Mexico → INTL by product decision |
| `generateSlug` — `database/event.model.ts` | Slug identity; scraper slugs are `generateSlug(title + ' ' + date)`. Importing the module defines the Mongoose model but needs no connection |

**Proposed runner: vitest** — least-config for a TS/ESM Next repo (jest needs a
transformer; node:test lacks TS + alias support). One config caveat, verified: 
`database/normalize.ts` imports via the `@/` alias (`@/lib/fetchers/geo` etc.), so the
vitest config must resolve it — `resolve: { alias: { '@': path.resolve(__dirname) } }` or
the `vite-tsconfig-paths` plugin (a second new dependency; prefer the manual alias).

**Fixture-capture procedure (captured real raw items, not hand-written):** run a
supervised fetch of a FREE source and save its raw output. The fetchers are importable —
`fetchLuma`, `fetchMlh`, `fetchCompany`, `fetchHackathons` (see the imports at the top of
`lib/scrape.ts`); each is `() => Promise<unknown[]>`. Sketch (run with `npx tsx`; wrap in
an async IIFE — tsx compiles `.ts` as CJS and rejects top-level await, per
`.claude/docs/gotchas.md`):

```ts
// capture-fixtures.ts — run: SCRAPE_MAX_ITEMS=5 npx tsx capture-fixtures.ts
// (free fetchers read no secrets — only SCRAPE_MAX_ITEMS; APIFY_TOKEN is paid-path only)
import { writeFileSync } from 'node:fs';
import { fetchLuma } from './lib/fetchers/luma';
(async () => {
  const raw = await fetchLuma();
  writeFileSync('tests/fixtures/luma.raw.json', JSON.stringify(raw.slice(0, 5), null, 2));
})();
```

Rules: free sources only (`fetchEventbrite`/`fetchMeetup` start paid Apify runs — G1
approval first, and any such run must set the `?maxItems=` RUN option, which
`lib/fetchers/apify.ts` already does); set `SCRAPE_MAX_ITEMS` low; commit fixtures so
tests never re-fetch; record the capture date in the fixture filename or a header key;
strip nothing — the point is the real shape. The capture script itself is read-only
against the world and writes nothing to the DB, so G2 is untouched.

Anti-scope: do NOT start with e2e/browser tests, DB-integration tests (they'd touch the
prod cluster — G2), or snapshot tests of React components. Pure-function characterization
first; everything else is a separate proposal.

## 7. Golden set: the db-sanity invariants

The standing golden checks any session can run in ~10 s, no approval needed (read-only):

```bash
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/db-sanity.mjs
```

Exit 0 = all invariants hold (clean pass re-verified 2026-07-20). The invariants, and what
a FAIL means:

| Invariant | On FAIL |
|---|---|
| Connected db name is **`test`** | You are pointed at the wrong cluster/URI — the app's data lives in the default db `test`, NOT `events_site`. Fix env before trusting anything (`northbound-build-and-env`) |
| Index parity: live `events` indexes == `database/event.model.ts` declarations (slug unique; fingerprint unique+sparse; `{mode,date}` `{city,date}` `{tags,date}` `{region,date}` `{date,_id}`; unweighted text) | Schema changed without `syncIndexes()`, or someone hand-edited Atlas. Route through `northbound-pipeline-engineering` |
| Zero `region:'INTL'` docs | The ADR-015 geo gate is leaking — a normalization/scrape regression. Treat as a failed pipeline change |
| Zero docs missing `url` or `fingerprint` | A write bypassed the scrape pipeline (G2 violation) or a mapper regression |
| Zero slug near-misses (distinct fingerprints sharing `generateSlug(title+' '+date)`) | The known silent-drop E11000 hole is live (two real events colliding on slug — see `northbound-architecture-contract` known-weak points). Currently 0; a FAIL means real data loss is occurring |

The `INFO 38/473 docs have a stored slug != generateSlug(...)` line (2026-07-20) is
informational legacy, not a failure. Run db-sanity before AND after any pipeline or schema
change, and whenever the DB "looks weird".

## When NOT to use this skill

- **Making the pipeline change itself** (fetchers, normalization, schema, dedup, config)
  → `northbound-pipeline-engineering`. This skill only judges the result.
- **Running/interpreting the instruments in depth**, Apify billing checks, cron-run
  inspection, screenshots → `northbound-diagnostics-and-tooling` (the scripts live there).
- **Whether you're allowed to do something** (spend, DB writes, deps, commits) →
  `northbound-change-control`.
- **Triaging a live failure** ("scrape wrote 0", E11000, wrong dates) →
  `northbound-debugging-playbook`; past incidents → `northbound-failure-archaeology`.
- **Doing UI work** (as opposed to accepting it) → `northbound-frontend-engineering`.
- **Triggering scrapes / operating the cron / deploying** → `northbound-run-and-operate`.
- **Designing an experiment or deciding if a hunch is proven** →
  `northbound-research-methodology` (idea lifecycle) and
  `northbound-proof-and-analysis-toolkit` (proof recipes). This skill supplies the
  acceptance thresholds those processes cite.
- **Improving coverage numbers** → `northbound-coverage-campaign`.
- **Fixing the stale docs this skill flags** → `northbound-docs-and-writing`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` plus verified commands: every
count in §2 was re-measured by running `source-health.mjs` and the per-organizer
aggregation on 2026-07-20; §5's tsc/lint/test-absence claims were re-run the same day;
§4's contrast ratios were computed from the shipped hex tokens; §7 is a clean db-sanity
run. Contrast-math and per-organizer snippets are inline above — no separate scripts
shipped with this skill.

Volatile facts and their one-line drift checks:

| Volatile fact (as of 2026-07-20) | Re-verify with |
|---|---|
| Per-source doc counts (473 total: company 255, hackathon 139, luma 33, eventbrite 29, mlh 17, meetup 0) | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs` |
| meetup has 0 docs ever / no `perSource` entry | same command — check the meetup row and `perSource` keys |
| db-sanity all-pass, 38 legacy slugs | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/db-sanity.mjs` |
| `COMPANY_SOURCES` has 38 entries | `node -e "console.log((require('fs').readFileSync('lib/fetchers/config.ts','utf8').match(/company: '/g)||[]).length)"` |
| No test files / no test configs | `find . -path ./node_modules -prune -o \( -name '*.test.*' -o -name '*.spec.*' \) -print` |
| `package.json` scripts = dev/build/start/lint only | `node -e "console.log(Object.keys(require('./package.json').scripts))"` |
| `npx tsc --noEmit` exits 0 | `npx tsc --noEmit; echo $?` |
| `npm run lint` red by baseline (FreshnessBadge error; counts owned by `northbound-build-and-env`) | `npm run lint 2>&1 \| tail -3` |
| playwright ^1.60.0 unimported by app code | `grep -rn "from 'playwright'" app components lib database --include='*.ts*'` (expect no hits) |
| backdrop/content-visibility grep baselines (§4) | the three greps in §4 verbatim |
| Design tokens unchanged (`#888f9d`, `#0a0b0d`, `#121419`, `#1e222b`, `#59deca`, `#fcd34d`) | `grep -n "888f9d\|59deca\|fcd34d" app/globals.css` |
| Opacity-modified light-200 debt sites (Footer /80, SearchBox /60, Pagination /40) | `grep -rn "light-200/" app components --include='*.tsx'` |
| Fetcher export names (`fetchLuma` … `fetchHackathons`) | `sed -n 1,10p lib/scrape.ts` |
| Legacy skills retired as RETIRED tombstones (frontend's stale body removed; original via git history) | `grep -l "RETIRED" .claude/skills/frontend/SKILL.md .claude/skills/scheduling/SKILL.md .claude/skills/backend-api/SKILL.md` (expect all three); `grep -c useSWR package.json` (expect 0) |
