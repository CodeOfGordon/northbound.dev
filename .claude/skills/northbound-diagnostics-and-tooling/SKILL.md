---
name: northbound-diagnostics-and-tooling
description: Measure instead of eyeball on Northbound (event aggregator) — run the shipped read-only instruments (source-health.mjs, coverage-report.mjs, db-sanity.mjs, screenshot.mjs), interpret their output against dated baselines, and inspect Apify billing/runs, the GitHub Actions scrape cron, PostHog capture sites, tsc/eslint status, and the read-only MongoDB MCP. Load for "how many events per source/lane/city", "is the DB healthy", "did my pipeline change help", "how much Apify credit is left", "did the cron run", "screenshot the app in WSL", or any before/after measurement.
---

# Northbound diagnostics and tooling

Every claim about Northbound's data or health must come from an instrument, not a glance at the UI. This skill ships four read-only scripts in `scripts/` (relative to this skill dir) and documents every other measurement surface. All scripts were written and test-run against the live Atlas DB on 2026-07-20; baselines below are from those runs.

**Read-only guarantee (G2):** every script and command here only reads. The MongoDB MCP is `--readOnly` by policy. Nothing in this skill writes to the prod DB, starts Apify actor runs, or costs money. If a diagnosis leads you to want a write or a paid run, stop and load `northbound-change-control` first.

## Quick start — the standard instrument panel

Run from the repo root (all three need `MONGODB_URI`; Node v22.22.2 has `--env-file`):

```bash
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/coverage-report.mjs
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/db-sanity.mjs
```

Before/after protocol for ANY pipeline change: run all three, save output, make the change, run a scrape (see `northbound-run-and-operate`), run all three again, diff. If you can't express the improvement as a diff of these outputs, you haven't measured it.

Notes that apply to all three:
- They connect with the app's exact pattern (`mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 })` — mirrors `connectDB` in `database/mongodb.ts`) and take the URI verbatim. The URI has no db path, so data lives in the default db **`test`**, not `events_site` — see `northbound-build-and-env` for that trap.
- `mongoose` resolves from the repo's `node_modules` via ancestor resolution (verified by running from `.claude/skills/*/scripts/`).
- `coverage-report.mjs` prints a benign stderr warning (`MODULE_TYPELESS_PACKAGE_JSON` … "Reparsing as ES module") from importing `lib/constants.ts` natively. Ignore it; do NOT "fix" it by adding `"type": "module"` to package.json.

## Instrument 1: source-health.mjs

Per-source doc counts, upcoming/past split (upcoming = `date >= today` in America/Toronto, same derivation as `todayInToronto()` in `lib/events.ts`), newest `updatedAt` per source, and the ScrapeMeta singleton (`{key:'scrape'}` in the `meta` collection — the doc behind the "Updated X ago" badge, written by `POST /api/refresh`).

Baseline, as of 2026-07-20:

| source     | docs | upcoming | past | newest updatedAt (UTC) |
|------------|-----:|---------:|-----:|------------------------|
| luma       |   33 |        5 |   28 | 2026-07-19T09:14:57 |
| eventbrite |   29 |        5 |   24 | 2026-06-10T04:58:55 |
| meetup     |    0 |        0 |    0 | — |
| mlh        |   17 |       11 |    6 | 2026-07-19T09:15:00 |
| company    |  255 |       96 |  159 | 2026-07-19T09:15:13 |
| hackathon  |  139 |        5 |  134 | 2026-07-19T09:15:03 |
| **TOTAL**  | **473** | **122** | **351** | |

meta baseline: `lastRunAt 2026-07-19T09:15:13.700Z`, `perSource` has exactly luma/mlh/hackathon/company (seconds apart, matching scrape.yml's per-source POST loop), `lastErrors []`.

**How to read it:**
- **Newest `updatedAt` per source ≈ the last time that source successfully wrote.** The scrape upsert `$set`s the whole doc, so Mongoose refreshes `updatedAt` on every matched re-scrape. A source whose newest `updatedAt` is days old has not run (or wrote nothing) since then. Eventbrite frozen at 2026-06-10 = not re-run since the Apify credit incident; it is not scheduled (paid — G1).
- **meetup = 0 docs is the known state**, not a new failure: the meetup fetcher has never completed a live run (credit exhausted mid-validation 2026-06; see `northbound-failure-archaeology`).
- **`perSource` missing eventbrite/meetup is expected** — paid sources have never run through `/api/refresh` since meta bookkeeping began (2026-06-21).
- **`lastErrors` non-empty** = per-source failures in the last run (errors are isolated per source; the run still completes). Match the error strings to fetchers in `lib/fetchers/` and go to `northbound-debugging-playbook`.
- **`perSource` timestamps older than ~24h across all free sources** = the nightly cron didn't fire or failed; check GH Actions (below).
- A `?? <value>` source row means a doc whose `source` isn't in the 6-value model enum — that's an invariant break; investigate immediately.

## Instrument 2: coverage-report.mjs

Upcoming events per lane and per city over the next 30 days (Toronto-local window). This is the primary metric of `northbound-coverage-campaign` — lane derivation imports `laneOf()` **live** from `lib/constants.ts` via Node's native TS type-stripping (verified working on Node v22.22.2; on failure the script falls back to a replica and prints `DRIFT WARNING` — if you ever see that warning, re-verify the replica against `laneOf` before trusting numbers).

Baseline, as of 2026-07-20 (window 2026-07-20 → 2026-08-19): **company 71, hackathon 7, local 5, total 83**. Top cities: Online 27, Toronto 13, San Francisco 8, New York 6, Redmond 4, Montreal 3.

**How to read it:**
- **`local 5` is the headline problem** — the Local lane (luma/eventbrite/meetup collapsed) is nearly empty in a 30-day window. This is the coverage-decay number the campaign exists to move. Do not "fix" it here; measure it here, act via `northbound-coverage-campaign`.
- **City fragmentation is real signal**: the baseline shows `San Francisco` (8), `San Francisco, CA` (1), and `San Francisco, CA, USA` (1) as three rows. That means `CITY_ALIASES` in `database/normalize.ts` doesn't cover these variants — a canonicalization gap that also splits fingerprints. Route fixes to `northbound-pipeline-engineering`.
- **Foreign cities (Sydney, Porto, Buenos Aires…) appearing is NOT a geo-gate failure by itself.** Verified 2026-07-20: those docs are `region:'ONLINE'` (online events keep their listed host city) or `region:'UNKNOWN'` (offline city the classifier doesn't recognize — kept by design, since unknown defaults to "maybe North America"). Only `region:'INTL'` docs would be a gate regression, and db-sanity checks that. Whether UNKNOWN-offline-foreign should be tightened is a product call — raise it, don't silently change the gate.
- Lane totals vs source counts differ by design: `laneOf` folds `mlh` + `source:'hackathon'` + `category:'hackathon'` into the hackathon lane and luma/eventbrite/meetup into local.

## Instrument 3: db-sanity.mjs — the invariant gate

Exits non-zero on any invariant violation → usable as a gate in any workflow. Baseline as of 2026-07-20: **ALL INVARIANTS HOLD, exit 0** (plus `INFO 38/473 docs have a stored slug != generateSlug(title+' '+date)` — legacy pre-date-era slugs, informational).

| Check | Expected | If it FAILs, it means |
|---|---|---|
| Connected db name | `test` | Someone added a db path to MONGODB_URI — the app and scripts now look at a different (likely empty) db. Restore the path-less URI or migrate deliberately (approval needed). |
| Index inventory on `events` | exactly 9 (below) | Schema index edits without `syncIndexes()`, or manual Atlas index fiddling. Diff against `database/event.model.ts`. |
| `region:'INTL'` count | 0 | The geo gate (`lib/scrape.ts` drops INTL pre-upsert) regressed, or a write bypassed the pipeline. |
| Docs missing `url` or `fingerprint` | 0 | A write bypassed the scraper upsert path (only that path sets fingerprint). |
| Slug near-misses (distinct fingerprints sharing a computed `generateSlug(title+' '+date)`) | 0 | Two different stored events would collide on the unique slug index — the silent-drop E11000 hole is live (see `northbound-architecture-contract`). |

Expected indexes (mirrors `database/event.model.ts`, verified live-identical 2026-07-20): `_id_`, `slug_1` (unique), `fingerprint_1` (unique+sparse), `mode_1_date_1`, `city_1_date_1`, `tags_1_date_1`, `region_1_date_1`, `date_1__id_1`, `title_text_description_text_tags_text`. The script also greps the model source and warns if its own expectation table went stale (7 `EventSchema.index()` calls expected as of 2026-07-20).

Region distribution context (measured 2026-07-20, all 473 docs): ONLINE 275, CA 93, US 81, UNKNOWN 24, INTL 0.

## Instrument 4: screenshot.mjs — UI verification in WSL

There is no system Chrome in this WSL environment (the chrome-devtools MCP fails here). Playwright's bundled Chromium IS installed (`~/.cache/ms-playwright/chromium-1223`, verified 2026-07-20) and the `playwright` devDependency resolves from the repo's node_modules — that's the whole reason the dependency exists (no test suite uses it).

```bash
# tested 2026-07-20 against a static file:// page — renders and saves a PNG
node .claude/skills/northbound-diagnostics-and-tooling/scripts/screenshot.mjs <url> <out.png> [width] [height] [--full]
# typical: screenshot the running dev server (start it yourself first — the script never starts servers)
mkdir -p .screenshots   # the script does NOT create the output directory
node .claude/skills/northbound-diagnostics-and-tooling/scripts/screenshot.mjs http://localhost:3000/events .screenshots/events.png 1280 800 --full
```

(`.screenshots/` is an untracked scratch dir at the repo root — never commit the PNGs. Any
writable path works; avoid machine-specific temp dirs in anything you write down.)

If Chromium is missing (fresh machine): `npx playwright install chromium` (one-time, ~150MB). Use screenshots as evidence for any UI claim ("the filter bar renders", "no horizontal overflow") — see `northbound-frontend-engineering` for what to check against DESIGN.md.

## Code-quality gates: what green/red actually means

| Command | Expected (as of 2026-07-20) | Meaning |
|---|---|---|
| `npx tsc --noEmit` | **exit 0, no output**, ~6s warm (re-measured 2026-07-20) | The de-facto pre-commit gate. Any diagnostic = your change broke it; fix before proceeding. |
| `npm run lint` | **exit 1** (re-verified 2026-07-20) | RED BY KNOWN BASELINE — do not chase phantoms. One real error (`react-hooks/purity`, `Date.now()` during render in `components/FreshnessBadge.tsx`) plus a warning bulk from untracked `.claude/` scripts eslint fails to ignore. Exact counts, causes, timing, and the fresh-clone caveat: `northbound-build-and-env` (that skill owns the numbers). |
| `npm run build` | succeeds | Note: Next 16's `next build` does NOT run ESLint, and there is no CI for build/lint/test — Vercel's deploy build is the only automated gate. |

Judge lint changes by the DELTA from the recorded baseline (run lint before and after your change; baseline counts: `northbound-build-and-env`), not by exit code. This skill's own scripts contribute 0 problems (verified with `npx eslint .claude/skills/northbound-diagnostics-and-tooling/scripts/`).

## MongoDB MCP — ad-hoc queries (read-only)

`.mcp.json` runs `npx -y mongodb-mcp-server@latest --readOnly` with `MDB_MCP_CONNECTION_STRING`. Use it for one-off questions the scripts don't answer (find a specific doc, explain a query, collection schema sampling).

- **Always target db `test`** (`list-collections`, `find`, `count`, `aggregate`, `collection-indexes` all take a database arg). `events_site` exists only in `.env.example`'s template and is EMPTY — an agent querying it will wrongly conclude the DB has no data.
- It cannot write (`--readOnly`). Deletes/backfills require a throwaway script and explicit approval — route through `northbound-change-control`.
- Prefer the shipped scripts for anything you'll compare over time; MCP output isn't a stable before/after format.

## Apify inspection — runs and billing (G1 territory)

Read-only GETs below are free and safe. STARTING a run costs money and requires gordon's approval first — and always via the `?maxItems=` RUN option (see `northbound-run-and-operate`).

```bash
# Last run of an actor (status, timestamps, usageTotalUsd, defaultDatasetId):
set -a; source .env.local; set +a
curl -s -H "Authorization: Bearer $APIFY_TOKEN" \
  "https://api.apify.com/v2/acts/easyapi~meetup-events-scraper/runs/last" | head -c 800
# swap actor: parseforge~eventbrite-scraper  (org/name joined with '~' in URLs)

# Item count of a run's dataset (no item download):
curl -s -H "Authorization: Bearer $APIFY_TOKEN" "https://api.apify.com/v2/datasets/<defaultDatasetId>"

# Credit/billing state — THE number for gate G1:
curl -s -H "Authorization: Bearer $APIFY_TOKEN" "https://api.apify.com/v2/users/me/limits"
```

Live-verified 2026-07-20: last meetup run was 2026-06-10, status **ABORTED**, `usageTotalUsd` ≈ **$2.02**, dataset itemCount **201** (the run behind the billing incident — the docs' "~$1.39" figure undercounts what the run record shows). Current cycle 2026-07-08 → 2026-08-07: `limits.maxMonthlyUsageUsd: 5`, `current.monthlyUsageUsd` ≈ **$0.0002** — the free credit HAS reset since the June exhaustion. In the web console, spend appears under console.apify.com → Billing/Usage (UI path not re-verified — trust the API numbers above).

Interpretation: before proposing any paid-source run, fetch `users/me/limits` and report `current.monthlyUsageUsd` vs the $5 cap in your proposal to gordon. Token via `Authorization: Bearer` header only — never `?token=` (it leaks into logs; same rule as `lib/fetchers/apify.ts`).

## GitHub Actions cron inspection

```bash
gh run list --workflow=scrape.yml --limit 10
gh run view <run-id> --log          # per-source curl output
```

Verified 2026-07-20: the three most recent runs are `completed success`, trigger `schedule` — **the nightly cron IS deployed and green** (any note claiming "cron still needs deploy+secrets" is stale). Reading results:
- `success` but sources failing: the job fails only if a per-source curl fails; check the log's per-source lines.
- The workflow SKIPS with a warning (still "success") on scheduled runs when `SITE_URL`/`CRON_SECRET` repo secrets are missing — a green history does not by itself prove scrapes happened. Cross-check with source-health.mjs `perSource` timestamps (fresh timestamps = real scrapes; that cross-check is what proved deployment on 2026-07-19).
- Runs fire later than the `15 7 * * *` cron spec (observed ~09:15 UTC vs 07:15) — normal GitHub Actions schedule drift, not a bug.
- Operating the cron (secrets, dispatch, editing scrape.yml) is `northbound-run-and-operate` territory.

## PostHog — client analytics capture sites

All capture points, verified by grep 2026-07-20 (`grep -rn 'posthog.capture(' components/`):

| Event name | File(s) |
|---|---|
| `event_card_clicked` | `components/EventCard.tsx`, `components/EventRow.tsx` (adds `view:'row'`) |
| `filter_applied` | `components/FilterBar.tsx` (two sites; clear sends `{cleared:true}`) |
| `search_performed` | `components/SearchBox.tsx` |
| `calendar_add_clicked` | `components/AddToCalendar.tsx` |
| `register_link_clicked` | `components/RegisterButton.tsx` |
| `explore_events_clicked` | `components/ExploreBtn.tsx` |

Init is `instrumentation-client.ts` (api_host `/ingest`, reverse-proxied via `next.config.ts` rewrites). **Dashboard-side verification (did events arrive, funnels, insights) happens in the PostHog web UI and is out of repo scope — this skill cannot check it.** Treat the six names as a frozen contract unless told otherwise; naming/props details live in `northbound-frontend-engineering`. Note: `posthog-setup-report.md` at the repo root is a stale pre-rebrand artifact — trust the grep, not that file.

## When NOT to use this skill

- **Changing the pipeline** (fetchers, normalization, schema, dedup, config) after measuring → `northbound-pipeline-engineering`.
- **Triggering scrapes, running paid Apify sources, deploying, cron/secret operations** → `northbound-run-and-operate`.
- **Environment is broken** (missing env vars, empty homepage, MCP won't start) or you want to FIX the red lint baseline → `northbound-build-and-env`.
- **Acting on coverage numbers** (adding sources/cities, the local-lane decay campaign) → `northbound-coverage-campaign`.
- **UI/design work or PostHog event changes** → `northbound-frontend-engineering`.
- **Triaging an unknown symptom** to decide what to measure → `northbound-debugging-playbook`; past incidents → `northbound-failure-archaeology`.
- **Deciding whether a measured result meets the evidence bar** for claiming something works → `northbound-validation-and-qa`; deeper proof recipes → `northbound-proof-and-analysis-toolkit`.
- **Permission questions** (may I write to the DB / spend credit / commit) → `northbound-change-control`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit 63a965a + live Atlas reads + verified command runs. All four scripts in `scripts/` were executed successfully on 2026-07-20 (source-health, coverage-report, db-sanity against the live DB; screenshot against a static `file://` page). Baselines in this file are actual captured output, not estimates.

Volatile facts — re-verify before relying on them:

| Fact (as of 2026-07-20) | One-line re-verification |
|---|---|
| 473 events docs; per-source split in the baseline table | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs` |
| Lane coverage: company 71 / hackathon 7 / local 5 (30-day window) | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/coverage-report.mjs` |
| All DB invariants hold (exit 0); 38 legacy slugs | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/db-sanity.mjs; echo $?` |
| `npx tsc --noEmit` green, ~6s | `time npx tsc --noEmit; echo $?` |
| `npm run lint` red by baseline (counts owned by `northbound-build-and-env`) | `npm run lint; echo $?` |
| Native TS import of `lib/constants.ts` works (Node v22.22.2) | `node -e "import('./lib/constants.ts').then(m=>console.log(m.laneOf('mlh')))"` |
| 7 `EventSchema.index()` declarations in the model | `grep -c 'EventSchema.index(' database/event.model.ts` |
| Playwright Chromium bundle present (chromium-1223) | `ls ~/.cache/ms-playwright` |
| Nightly cron green, trigger `schedule` | `gh run list --workflow=scrape.yml --limit 3` |
| Apify usage ≈ $0.0002 of $5/mo cap; cycle resets 2026-08-07 | `set -a; source .env.local; set +a; curl -s -H "Authorization: Bearer $APIFY_TOKEN" https://api.apify.com/v2/users/me/limits \| head -c 700` |
| Six PostHog event names at the listed files | `grep -rn 'posthog.capture(' components/` |
| Data lives in db `test` (URI has no db path) | db-sanity.mjs check 1, or `node --env-file=.env.local -e "console.log(new URL(process.env.MONGODB_URI).pathname.slice(1) \|\| '(no db path -> defaults to test)')"` |
