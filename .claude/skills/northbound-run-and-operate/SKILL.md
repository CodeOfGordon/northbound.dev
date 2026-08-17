---
name: northbound-run-and-operate
description: Operate the live Northbound system — start the dev server, trigger scrapes via POST /api/refresh (free vs paid Apify sources), read and debug the nightly GitHub Actions scrape cron (scrape.yml), check freshness via the meta doc, deploy on Vercel, and follow prod Atlas etiquette. Load for symptoms like "run a scrape", stale "Updated X ago" badge, 401 from /api/refresh, red/green cron runs, gh run list, or an on-demand eventbrite/meetup top-up.
---

# Northbound: run and operate

Runbook for operating the running system. Northbound is an event aggregator: a Next.js app on Vercel reads/writes a MongoDB Atlas M0 cluster. As of 2026-08-16 (ADR-023) the nightly GitHub Actions workflow is **three chained jobs**: `scrape` (POSTs to `/api/refresh`, runs the scrape pipeline — `lib/scrape.ts` `runScrape` — over seven sources and upserts events) → `enrich` (`scripts/enrich-hackathons.mjs`, writes hackathon application/travel signals straight to Atlas) → `digest` (POSTs to `/api/digest`, emails gordon anything new/open/deadline-approaching). There is **no staging** — the Atlas cluster is production.

Two hard gates dominate operations (full rules in **northbound-change-control**):

- **G1 — $0 hosting**: `eventbrite` and `meetup` run paid Apify actors. Never schedule them; never trigger them without gordon's explicit prior approval. Everything else is free direct fetches.
- **G2 — prod DB is sacred**: no writes outside the sanctioned writers (the scrape pipeline; the enrichment script's `enrichment`-subdoc writes, ADR-020; the digest's per-subscriber cursor/`notifiedOpenIds` writes and the public `/api/subscribe`+`/api/unsubscribe` routes, ADR-026) without explicit approval; the MongoDB MCP server is `--readOnly` (`.mcp.json`); destructive ops need a backup step first.

## Dev server

```bash
npm run dev
```

- `package.json` `scripts.dev` is bare `next dev` — no port flag, so the default is `http://localhost:3000`. **Read the terminal banner for the actual port**: Next auto-increments when 3000 is busy, and past sessions have ended up on nonstandard ports. Never assume 3000 in follow-up curls; copy the URL the banner prints.
- Env comes from `.env.local` (see **northbound-build-and-env** for the full var catalog). The server starts fine without `MONGODB_URI` but pages degrade; `/api/refresh` returns 401 whenever `CRON_SECRET` is unset (fail-closed, `app/api/refresh/route.ts`).
- `.envrc` (`dotenv .env.local`, needs one-time `direnv allow`) loads the same vars into your shell so `$CRON_SECRET` works in curl commands below. It is gitignored — recreate it on a fresh clone.

## Triggering scrapes: POST /api/refresh

The only scrape entry point is `POST /api/refresh` (`app/api/refresh/route.ts` → `runScrape` in `lib/scrape.ts`). Auth is `Authorization: Bearer $CRON_SECRET`, fail-closed (401 on mismatch or unset secret).

**The safe default command** (free sources only, against the dev server):

```bash
curl -X POST http://localhost:3000/api/refresh \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sources":["luma","mlh","hackathon","watchlist","company"]}'
```

Valid source names (the `FETCHERS` registry in `lib/scrape.ts`, type `ScrapeSource`):

| Source | Cost | What it hits |
|---|---|---|
| `luma` | free | direct public `api.lu.ma` JSON (city discovery pages) |
| `mlh` | free | `www.mlh.com` season pages (embedded JSON) — moved off `mlh.io` 2026-08-16 |
| `company` | free | 38-entry company registry as of 2026-07-20 (`lib/fetchers/config.ts` `COMPANY_SOURCES`; count owner: `northbound-pipeline-engineering`) via provider adapters |
| `hackathon` | free | aggregator: Devpost (online + in-person), lu.ma discover, DoraHacks, ETHGlobal |
| `watchlist` | free | curated named hackathons (HackMIT, Cal Hacks, PennApps, …) polled off their own sites — added 2026-08-16, ADR-019 |
| `eventbrite` | **PAID (Apify)** | `parseforge/eventbrite-scraper`, one run per city — G1 approval required |
| `meetup` | **PAID (Apify)** | `easyapi/meetup-events-scraper`, one batched run — G1 approval required |

### Sharp edges — read before running

1. **Omitting the body runs ALL SEVEN sources, including paid ones.** Same for a *malformed* body: the route does `request.json().catch(() => ({}))`, so a shell-quoting mistake silently becomes "run everything". If `APIFY_TOKEN` is set (it is, in the local `.env.local`), that bills Apify credit. Always pass an explicit free-source list unless a paid run was approved under G1.
2. **Typo'd source names are silently dropped, not errors.** `runScrape` intersects your list with the registry; `{"sources":["lumma"]}` runs nothing and returns `"sources": []` with `ok: true`. Always check the `sources` array in the response echoes what you intended.
3. Against the **deployed** site, send **one POST per source** (like the cron does) — the production function-duration ceiling is uncertain (see Deploy section; plan for ~60s). Locally there is no cap; a multi-source body is fine.

### Response shape and semantics

```json
{ "ok": true, "sources": ["luma"], "upserted": 3, "modified": 41, "errors": [], "ranAt": "2026-07-19T09:15:13.700Z" }
```

- Per-source failures do **not** fail the HTTP call — you get 200 with entries in `errors` (`"<source>: <message>"` for a whole-source failure, `"<source>: skipped item — <message>"` for one bad item). Error isolation is per-source and per-item; one dead endpoint degrades to a warning.
- Mongo `E11000` duplicate-key at bulkWrite level is absorbed as a benign cross-source dedup race (`lib/scrape.ts`) — counts still accumulate, no error recorded.
- `upserted` = new events; `modified` = existing events refreshed. Both 0 with empty `errors` usually means the source returned items already stored unchanged — not a failure.

### Freshness bookkeeping (the meta doc)

After each run the route upserts a **singleton** doc `{key: 'scrape'}` in the `meta` collection (model `ScrapeMeta`, `database/meta.model.ts`, db `test`):

- `perSource.<source>` timestamps merge via **dot-notation** — a single-source run never clobbers the other sources' timestamps.
- `lastRunAt`, `lastSources`, `lastUpserted`, `lastModified`, `lastErrors` reflect **only the most recent POST**. Because the cron sends one POST per source in the order `luma mlh hackathon company`, after a nightly run `lastSources` is `["company"]` — that is normal, not a bug. Use `perSource` for the real per-source picture.
- The UI reads this via `getScrapeStatus()` in `lib/meta.ts` (called by `components/Footer.tsx` and `app/page.tsx`, rendered as `FreshnessBadge`). It is deliberately crash-proof: falls back to the newest `Event.updatedAt` (`basis: 'derived'`) and returns an empty status on any DB failure — so a missing badge is a symptom, never a crash. Badge internals belong to **northbound-frontend-engineering**.

To inspect the meta doc read-only: MongoDB MCP `find` on database `test`, collection `meta`, filter `{"key": "scrape"}`.

## The nightly chain: .github/workflows/scrape.yml (3 jobs as of 2026-08-16, ADR-023)

The **only scheduler is GitHub Actions** — there is no `vercel.json`, hence no Vercel Cron. One workflow, name `Scrape events`, now **three chained jobs**: `scrape` → `enrich` (`needs: scrape, if: always()`) → `digest` (`needs: [scrape, enrich], if: always()`). `if: always()` on both downstream jobs is deliberate: a partial `scrape` failure must not suppress `enrich`/`digest` for whatever data did land, and the `digest` job specifically needs to run last so it sees the night's fresh events and application-status flips. Rejected alternatives: separate workflows / `workflow_run` chaining (loses one-page visibility) and a later independent cron for enrich/digest (races the scrape).

| Fact | Value (as of 2026-08-16) |
|---|---|
| Schedule | single cron `'15 7 * * *'` = 07:15 UTC ≈ 03:15 ET nightly — unchanged, still drives all three jobs |
| Manual trigger | `workflow_dispatch` with a **space-separated** `sources` input (default `luma mlh hackathon watchlist company`) and an `enrich_budget` input (default `'25'`, see below) |
| Secrets required | `scrape`+`digest` jobs: GitHub repo secrets `SITE_URL` (deployed base URL, no trailing slash) + `CRON_SECRET` (must equal the deployment's env var). `enrich` job: repo secret **`MONGODB_URI`** (new 2026-08-16 — the enrichment script writes to Atlas directly, not via `/api/refresh`) |
| Missing secrets | every job **soft-skips with a ::warning and stays green** when its secrets are unset; only `workflow_dispatch` on the `scrape` job **hard-fails** with ::error |
| `scrape` request pattern | one `curl --fail-with-body -sS -X POST "$SITE_URL/api/refresh"` per source, `--max-time 90` |
| `enrich` step | `node scripts/enrich-hackathons.mjs --budget "${{ github.event.inputs.enrich_budget || '25' }}"` after `actions/checkout` + `actions/setup-node@v4` (node 20) + `npm ci` |
| `digest` request pattern | one `curl --fail-with-body -sS -X POST "$SITE_URL/api/digest" -d '{}'`, `--max-time 90` |
| Paid sources | `eventbrite`/`meetup` deliberately **not scheduled** (G1) — header comments in the workflow say to run them on demand from your own machine |

**Status as of 2026-07-20 (last live-verified before the 3-job chain landed): the scrape leg was live and green end-to-end.** Verified two ways: `gh run list --workflow=scrape.yml` showed consecutive green *scheduled* runs (~17–27s each), and the live meta doc showed the 2026-07-19 run stamped all four free sources in `perSource` with `lastErrors: []`. Re-verify the `enrich`/`digest` legs the same way after the next scheduled run (`gh run view --job=<enrich-or-digest-job-id> --log`) — they are new as of 2026-08-16 and not yet independently confirmed live-green.

Operator notes:

- **Green ≠ scraped/enriched/sent.** A scheduled run with missing secrets also shows green (skip-with-warning) for whichever job that applies to. To confirm a job actually did work, open its log (`gh run view --job=<job-id> --log` and look for the per-source `::group::` output on `scrape`, the `console.table` summary on `enrich`) or check the meta doc's `perSource` timestamps / the digest's own logging.
- **Schedule drift is normal.** GitHub fires crons late under load — the 2026-07-19 run scheduled for 07:15 UTC actually ran ~09:15 UTC. A 1–3h delay is not an incident.
- **The `--max-time 90` sharp edge** (applies to both `scrape` and `digest`'s curl calls): if a call takes longer than 90s, CI kills it and reports that step failed **even if the server-side work completes fine**. Discriminate by checking the meta doc / event counts / Resend delivery before treating a red step as a real failure.
- The `scrape` job exits nonzero if **any** source's curl failed; the other sources still ran (the loop continues). `enrich` and `digest` don't have that per-item loop-and-continue shape — a single job either completes or doesn't.

### Enrichment script CLI (`scripts/enrich-hackathons.mjs`)

Runnable standalone (not just via the workflow) for debugging or manual backfills:

```bash
node --env-file=.env.local scripts/enrich-hackathons.mjs [--dry-run] [--budget N] [--host example.org]
```

- `--dry-run` — classify and log, **no writes**. Always run this first when testing a
  classifier change.
- `--budget N` — cap on hosts enriched this run (default 25, matches the workflow's
  `enrich_budget` dispatch input — raise it for a one-off backfill of stale hosts).
- `--host example.org` — enrich exactly one host regardless of its staleness cadence
  (bypasses the 3d/7d staleness check) — the fast path for testing one hackathon's page
  against the classifiers. Domain knowledge (classifiers, budgets, overrides file, cadence
  rules) lives in `northbound-source-platforms-reference`; this section is only the
  operator-facing "how do I run it" surface.

### Digest (`scripts/send-digest.mjs` + `POST /api/digest`)

**The route never sends email.** Vercel blocks outbound SMTP, so `/api/digest` only
*composes* (one personalized message per active subscriber, no state written) and later
*confirms*; the GitHub runner does the Gmail SMTP send in between (ADR-025/026).
Recipients come from the `subscribers` collection (people sign up at `/subscribe`) — there
is no recipient env var.

Operate it through the script, not raw curl:

```bash
# Compose + print what WOULD go out, per subscriber. Sends nothing, confirms nothing.
export SITE_URL=http://localhost:3000 GMAIL_USER=... GMAIL_APP_PASSWORD=...
node scripts/send-digest.mjs --dry-run

# Real send (per-subscriber same-day guard applies)
node scripts/send-digest.mjs

# Re-send today (bypasses the same-day guard — these are real emails)
node scripts/send-digest.mjs --force
```

The route itself, if you need it directly: `{mode:'compose', force?, dryRun?}` returns
`{messages:[{subscriberId,to,subject,html,text,headers,openIds,counts}], cursor}`;
`{mode:'confirm', cursor, results:[{subscriberId,openIds}]}` advances each delivered
subscriber's cursor and appends their `notifiedOpenIds`. Only confirm what actually sent —
unconfirmed subscribers simply retry next run (at-least-once).

Missing Gmail secrets are a **soft skip** (green job + `::warning::`), not a failure, so a
half-configured deployment never paints the nightly run red.

### Reading and driving the workflow

```bash
gh run list --workflow=scrape.yml --limit 10       # recent runs: status, trigger, duration
gh run view <run-id>                               # job summary for one run
gh run view --job=<job-id> --log                   # full log incl. per-source ::group:: output
gh workflow run 'Scrape events'                    # manual dispatch, default free sources
gh workflow run 'Scrape events' -f sources='luma mlh'   # scoped dispatch (space-separated)
gh secret set SITE_URL --body "https://<deployment>.vercel.app"   # (re)wire secrets
gh secret set CRON_SECRET --body "<same value as deployment env>"
```

All verified against the installed `gh` CLI and the workflow file. Never pass paid sources to `gh workflow run` — that is a scheduled-context paid run and violates G1.

Known stale doc: `docs/scheduled-scrape.md` "Schedule" section still claims a weekly Sunday paid-source cron. **False** — commit `66c40f7` removed it; the workflow has exactly one cron and paid sources are manual-only. The same doc's setup/troubleshooting sections are otherwise accurate.

## Deploy (Vercel)

- Project: **northbound-dev** (`.vercel/project.json`: `projectId prj_du0T1fsIlf8tU6yfHeqFfsNTXxFp`), Vercel Hobby tier, paired with Atlas free tier. Git remote is `https://github.com/CodeOfGordon/northbound.dev.git`.
- No `vercel.json` exists → no Vercel-side cron, no route config overrides. GitHub Actions is the only scheduler.
- Deployment env vars come from `.env.example`'s catalog — at minimum `MONGODB_URI` and `CRON_SECRET`; `APIFY_TOKEN` only if paid sources will ever run on-host (they currently should not — G1). **Updated 2026-08-17 (ADR-026):** the digest needs **no Vercel env vars** — Resend is gone, recipients live in the `subscribers` collection, and sending happens in the GitHub runner via repo secrets `GMAIL_USER` + `GMAIL_APP_PASSWORD` (Google App Password, requires 2FA on that account). `NEXT_PUBLIC_SITE_URL` should be `https://northbound-dev.vercel.app` — **that is the live host**; `northbound.vercel.app` 404s and was a real bug source (email links now derive from `request.nextUrl.origin` instead).
- **UNVERIFIED — deploy trigger**: whether Vercel auto-deploys on push to `main` or deploys run via CLI is not provable from the repo. Check before relying on it: Vercel dashboard → northbound-dev → Settings → Git, or `vercel project inspect northbound-dev` (a global `vercel` CLI is installed as of 2026-07-20; it needs an authenticated session). Until verified, hold both cautions at once: treat every push as if it MAY deploy to prod (so never push unrequested — G4), and never rely on a push HAVING deployed (verify in the dashboard). Same wording in `northbound-change-control` G4.
- **OPEN — canonical URL**: `app/layout.tsx` (`const SITE_URL`) falls back to `https://northbound.vercel.app`, but the Vercel project is `northbound-dev` (→ `northbound-dev.vercel.app`, the hostname the workflow comments and docs use). `NEXT_PUBLIC_SITE_URL` is consumed there but absent from `.env.example`. Resolution is pending the owner's domain/repo rename — do not "fix" the fallback without asking (see **northbound-change-control**).
- **UNVERIFIED — function-duration ceiling**: `app/api/refresh/route.ts` sets `maxDuration = 300`, but `scrape.yml`'s comments assume "Vercel Hobby's ~60 s function cap". Which binds in production is unproven. **Planning assumption: 60s** for anything scheduled — which is why the cron sends one POST per source and why paid (slow, 1–5 min) Apify runs must be driven from a local machine, never on-host.

Deploy-adjacent build facts (Next 16 `next build` does not run ESLint; `npm run lint` is currently red; `npx tsc --noEmit` is the de-facto gate) live in **northbound-build-and-env**.

## Atlas M0: what you are operating

- Cluster tier M0: **512 MB storage cap**, shared RAM. The app db is **`test`** (Mongoose's default when the URI has no db path) — always confirm which db you are in before reading numbers; collections: `events`, `meta`, `bookings`.
- Measured 2026-07-20 via read-only MCP: 473 events (351 with `date <` today, i.e. past), 474 objects total, dataSize ~464 KiB, storageSize ~528 KiB, indexSize ~1.13 MiB. Storage is nowhere near the cap, but **~74% of stored events are past and nothing prunes them** — growth is monotonic.
- **Retention is an open product question. Do NOT prune, TTL-index, or delete past events without gordon's explicit approval (G2)** — and any approved deletion needs a backup step first (e.g. `mongodump`/MCP `export` of the affected slice). Track growth with the diagnostics in **northbound-diagnostics-and-tooling** rather than eyeballing.

## Prod-DB etiquette (G2)

1. **Inspection**: use the MongoDB MCP server — it is launched `--readOnly` (`.mcp.json`) and cannot write. This is the default tool for counts, finds, schema checks.
2. **Writes** happen in one of four sanctioned ways (grew from two to four on 2026-08-16
   with the enrich/digest jobs, ADR-020/021/022):
   - the scrape pipeline (via `/api/refresh`) — the normal path, `$set`s the whole
     normalized doc per event;
   - the enrichment script (via `scripts/enrich-hackathons.mjs`, GH runner → Atlas
     directly) — `$set`s **only** the `enrichment` subdoc, field-ownership-excluded from the
     scrape's `$set` so the two can never clobber each other (I11);
   - the digest route (via `/api/digest`) — `meta` upsert `{key:'digest'}` plus
     `events.updateMany $set notifiedOpenAt` (and the enrichment script's courtesy
     `$unset notifiedOpenAt` on a real open→closed transition);
   - an **approved one-off script**, only after explicit sign-off, for cleanups none of the
     above can do (upserts never delete: after a filter/gate tightens, stale rows need
     manual `deleteMany`/backfill — this happened with the ADR-015 region gate).
3. One-off script pattern (repo-proven, documented in `.claude/docs/gotchas.md`): put a throwaway script **inside the repo root** so `mongoose` resolves from the repo's `node_modules`; run with the env loaded (direnv shell or explicit `export MONGODB_URI=...`). Two working shapes:
   - `npx tsx script.ts` — must wrap awaits in an async IIFE (tsx compiles `.ts` as CJS, rejects top-level await);
   - `node script.mjs` — native top-level await, no IIFE needed.
   Use `mongoose.connection.db.collection('events')` for raw ops — going through the model strips fields the schema doesn't know.
4. Before any approved destructive op: state the exact filter, run the matching **count** read-only first, back up the slice, then execute, then re-count. Proof discipline for this lives in **northbound-proof-and-analysis-toolkit**.
5. The `.claude/docs/decisions.md` follow-up claiming 8 stale pre-normalization docs (city `Montréal`, one `&#8211;` title) is **NOT reproducible live** — 0 matching docs as of 2026-07-20 (see `northbound-failure-archaeology` A28). Treat the follow-up as stale: re-run the counts before proposing any cleanup, and do not script a delete for docs that no longer exist (a G2 write for nothing).

## Paid-source protocol (G1-gated): on-demand eventbrite/meetup top-up

Paid runs are legitimate (that is why the fetchers exist) but every one costs Apify credit from a ~$5/mo free allowance that has been exhausted before. Protocol:

1. **Get approval first.** Message gordon with: which sources, expected item count, and a cost ceiling estimate. No approval, no run — regardless of how small.
2. **Pre-declare the caps.** The universal cap is `SCRAPE_MAX_ITEMS` (env, default 50 → `MAX_ITEMS` in `lib/fetchers/config.ts`). Per-fetcher shapes (all verified in code):
   - `eventbrite` (`lib/fetchers/eventbrite.ts`): one actor run per each of 4 Canadian city slugs, `maxItems` per run = `max(5, floor(MAX_ITEMS/4))`, memory 1024 MB;
   - `meetup` (`lib/fetchers/meetup.ts`): ONE batched run over all search URLs (flat ~$0.09 start fee per run + per-result), `maxItems = MAX_ITEMS`, memory 2048 MB, timeout 280s.
3. **The run-option cap is the only real cap.** `lib/fetchers/apify.ts` `runActor` always sets `?maxItems=` and `?memory=` as **run options** on the start request — an actor's `maxItems` *input* field is advisory (the meetup actor once ignored it and billed ~10× the request). If you ever bypass `runActor`, you must set the run options yourself.
4. **Run from a local machine** against the dev server (no function-duration cap, your terminal shows the result):
   ```bash
   curl -X POST http://localhost:3000/api/refresh \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"sources":["eventbrite","meetup"]}'
   ```
   To lower the spend for a trial: `SCRAPE_MAX_ITEMS=20 npm run dev` before triggering.
5. **Verify billing after the run** — actual items collected and charge vs your pre-declared ceiling (Apify console → the run's usage, or the Apify MCP `get-actor-run`). The worked recipe for proving what a run billed is **northbound-proof-and-analysis-toolkit** (billing-verification recipe).
6. Record outcome: a meetup run that completes end-to-end would close the long-open "meetup never live-verified" item (see **northbound-failure-archaeology**); note results in the docs of record per **northbound-docs-and-writing**.

## When NOT to use this skill

- Changing scraper/normalization/schema/dedup/config **code** → **northbound-pipeline-engineering** (this skill only *runs* the pipeline).
- UI, filter-state, freshness-badge internals, API-surface code → **northbound-frontend-engineering**.
- Recreating the environment, env-var catalog, install traps, lint/tsc gates → **northbound-build-and-env**.
- A failure you cannot yet localize (symptom → triage) → **northbound-debugging-playbook**; past incidents and their evidence → **northbound-failure-archaeology**.
- Measuring source health, coverage, DB sanity with shipped scripts → **northbound-diagnostics-and-tooling**.
- What class of change needs whose approval; ADR discipline → **northbound-change-control**.
- Proving a cost/billing/count claim rigorously → **northbound-proof-and-analysis-toolkit**.
- Deciding *whether/what* to top up (local-coverage strategy) → **northbound-coverage-campaign**; platform behavior and anti-bot reality → **northbound-source-platforms-reference**.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` plus live read-only checks (gh CLI against the real workflow runs; MongoDB MCP against the live Atlas cluster). All commands were verified against `package.json`, `app/api/refresh/route.ts`, `lib/scrape.ts`, `lib/meta.ts`, `database/meta.model.ts`, `.github/workflows/scrape.yml`, `lib/fetchers/{apify,eventbrite,meetup}.ts`, and `.vercel/project.json`; `gh run list`/`gh run view` were executed for real.

Volatile facts and how to re-verify each:

| Fact (as of 2026-07-20) | Re-verify with |
|---|---|
| Cron live and green, ~17–27s runs | `gh run list --workflow=scrape.yml --limit 5` |
| Latest run actually scraped (not secret-skip) | `gh run view --job=$(gh run list --workflow=scrape.yml --limit 1 --json databaseId -q '.[0].databaseId' \| xargs -I{} gh run view {} --json jobs -q '.jobs[0].databaseId') --log \| grep '::group::'` — or check meta `perSource` via MCP |
| Meta doc freshness / `lastErrors` empty | MongoDB MCP `find`: db `test`, coll `meta`, filter `{"key":"scrape"}` |
| 473 events / 351 past, no pruning | MongoDB MCP `count`: db `test`, coll `events` (past: filter `{"date":{"$lt":"<today>"}}`) |
| Dev script has no port flag | `grep '"dev"' package.json` |
| Refresh route: Bearer auth, maxDuration 300, body-parse fallback `{}` | `grep -n 'CRON_SECRET\|maxDuration\|catch(() => ({}))' app/api/refresh/route.ts` |
| Seven registered sources (incl. `watchlist`, added 2026-08-16) | `grep -n 'ScrapeSource =' lib/scrape.ts` |
| Single nightly cron `15 7 * * *`, free-source list, `--max-time 90` | `grep -n "cron:\|luma mlh hackathon watchlist company\|max-time" .github/workflows/scrape.yml` |
| Three chained jobs (scrape → enrich → digest), `needs`/`if: always()` | `grep -n "^jobs:\|needs:\|if: always" .github/workflows/scrape.yml` |
| `MONGODB_URI` repo secret feeds the `enrich` job | `grep -n "MONGODB_URI" .github/workflows/scrape.yml` |
| `enrich_budget` dispatch input, default `'25'` | `grep -n "enrich_budget" .github/workflows/scrape.yml` |
| `/api/digest` route: Bearer auth, dryRun/since/force body, maxDuration 60 | `grep -n "CRON_SECRET\|maxDuration\|dryRun\|force" app/api/digest/route.ts` |
| `RESEND_API_KEY`/`DIGEST_EMAIL` required by `runDigest` | `grep -n "RESEND_API_KEY\|DIGEST_EMAIL" lib/notify/digest.ts .env.example` |
| Enrichment script CLI flags (`--dry-run`/`--budget`/`--host`) | `grep -n "DRY_RUN\|BUDGET\|ONLY_HOST" scripts/enrich-hackathons.mjs` |
| No vercel.json → no Vercel cron | `ls vercel.json` (expect: No such file) |
| Vercel project name northbound-dev | `cat .vercel/project.json` |
| Layout canonical fallback `northbound.vercel.app` (OPEN ambiguity) | `grep -n NEXT_PUBLIC_SITE_URL app/layout.tsx` |
| MongoDB MCP is read-only | `grep -n readOnly .mcp.json` |
| Paid caps: eventbrite 1024 MB per-city, meetup 2048 MB one batch | `grep -n 'memoryMb\|maxItems' lib/fetchers/eventbrite.ts lib/fetchers/meetup.ts` |
| Weekly paid cron claim in docs is stale | `git log --oneline -1 66c40f7` + `grep -n 'Weekly' docs/scheduled-scrape.md` |

Unverified/open items carried in the body: deploy trigger (push vs CLI), canonical production URL, effective function-duration ceiling (plan 60s), event retention policy, meetup end-to-end validation.
