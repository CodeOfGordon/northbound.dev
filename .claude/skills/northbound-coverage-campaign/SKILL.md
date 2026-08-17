---
name: northbound-coverage-campaign
description: The executable, decision-gated campaign against Northbound's hardest live problem — local/community event coverage decaying to near-zero while hosting must stay $0. Load when the Local lane looks empty or stale, when Eventbrite/Meetup data is aging out, when asked to "add more local events / more sources / more cities", when considering a paid Apify top-up or the meetup verify-or-retire decision, or when measuring whether coverage work actually moved the numbers.
---

# Northbound coverage campaign — Local coverage at $0

**The problem (owner-confirmed 2026-07-19):** Northbound's Local lane — the `/events?source=local` tab, which collapses the `luma`, `eventbrite`, `meetup` sources (`LOCAL_SOURCES`, `lib/events.ts`) — is decaying toward empty. Measured 2026-07-20: luma contributes 5 upcoming docs, eventbrite 5 (none refreshed since 2026-06-10, aging out), meetup 0 docs ever. The product's core promise (PRODUCT.md: "find a relevant, real, upcoming event fast") fails in the Local lane first. Paid sources are frozen by the $0 gate. This skill is the campaign to fix that: numbered phases, exact commands, expected numbers, and explicit branches.

**Hard gates that bind every phase** (see northbound-change-control for the full rules):
- **G1 $0 hosting** — no paid Apify run without gordon's explicit prior approval; run-option `?maxItems=` always set (input fields are advisory — `lib/fetchers/apify.ts` `RunOptions`).
- **G2 prod DB is sacred** — every measurement below is read-only; DB writes happen only through the scrape pipeline.
- **G4** — all code changes: branch-first, no commit/push unless gordon asks, no AI attribution.

## Definitions (project terms, defined once)

| Term | Meaning | Source of truth |
|---|---|---|
| Local lane | Events with `source ∈ {luma, eventbrite, meetup}`; the `/events?source=local` tab filters by source only | `LOCAL_SOURCES`, `queryEvents` in `lib/events.ts` |
| Lane derivation | `laneOf(source, category)`: `company` → company; `mlh`/`hackathon` source OR `category==='hackathon'` → hackathon; else local. NB: a luma doc with `category:'hackathon'` shows in the Local *tab* but counts as *hackathon lane* in lane reports | `laneOf()` in `lib/constants.ts` |
| Upcoming | `date >= todayInToronto()` — `date` is a `YYYY-MM-DD` string; lexical compare === chronological | `todayInToronto()` in `lib/events.ts` |
| Product region | Canada-first: GTA, Ottawa, Montreal, Quebec City; then wider North America + online | PRODUCT.md "Users"; ADR-011 in `.claude/docs/decisions.md` |
| Target cities | `Toronto, Mississauga, Ottawa, Montreal, Quebec City` (Mississauga is in-region GTA and an existing `EVENTBRITE_CITIES` slug) | `lib/fetchers/config.ts` |
| Nightly cron | `.github/workflows/scrape.yml`, cron `'15 7 * * *'`, free sources only (`luma mlh hackathon company`), one POST per source | the workflow file |
| Free sources | luma, mlh, hackathon, company — direct fetches, no Apify | `lib/scrape.ts` FETCHERS + scrape.yml header |

## THE CAMPAIGN METRIC

**Primary (script-measured, never eyeballed):** the `local` row of the per-city table printed by `coverage-report.mjs` (lane = `laneOf()`, window = next 30 days Toronto-local), summed over the five target cities.

```bash
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/coverage-report.mjs
```

**Baseline 2026-07-20: metric = 5** (Toronto 2, Montreal 2, Mississauga 1, Ottawa 0, Quebec City 0).

**Secondary numbers to log alongside** (same date, for context — do not substitute for the metric):
- Local-*tab* count (what a user sees; source-based, upcoming, no 30-day bound): **10** — Toronto 4, Montreal 3, Ottawa 2, Mississauga 1, Quebec City 0. The gap vs the metric: 2 luma docs are `category:'hackathon'` ("Cursor Hackathon Toronto - July" 2026-07-22, "Agentic HackNight #1" 2026-07-29) and land in the hackathon lane; Ottawa's 2 eventbrite docs fall beyond the 30-day window.
- All-lane upcoming in the five target cities: **26** (company 12, eventbrite 5, luma 5, mlh 4) — captures company-lane additions of local orgs.

Track the metric **across nightly cron cycles** (the cron refreshes luma nightly; eventbrite/meetup only move on manual paid runs). **Campaign success = metric sustained above 5 across ≥2 consecutive cycles, measured by the script.** Every measurement and decision goes into `LOG.md` in this skill's directory (convention at the bottom).

---

## Phase 0 — Baseline (executed 2026-07-20; re-run at campaign start and after every change)

```bash
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/coverage-report.mjs
```

**Measured 2026-07-20 (the opening baseline — first entry in LOG.md):**

| source | docs | upcoming | newest updatedAt (UTC) |
|---|---:|---:|---|
| luma | 33 | 5 | 2026-07-19T09:14:57Z |
| eventbrite | 29 | 5 | 2026-06-10T04:58:55Z |
| meetup | 0 | 0 | — |
| mlh | 17 | 11 | 2026-07-19T09:15:00Z |
| company | 255 | 96 | 2026-07-19T09:15:13Z |
| hackathon | 139 | 5 | 2026-07-19T09:15:03Z |
| **TOTAL** | **473** | **122** | |

30-day lanes: company 71, hackathon 7, **local 5**, total 83. Meta singleton: `lastRunAt 2026-07-19T09:15Z`, all four free-source `perSource` timestamps 2026-07-19, `lastErrors: []` — the nightly cron is live and green as of 2026-07-20 (it fired ~09:15 UTC, ~2 h after the 07:15 slot — normal GitHub Actions cron drift).

**Gate 0 branches:**
- `db:` line is not `test` → wrong `MONGODB_URI` (the app's data lives in Atlas db `test`) → stop, load northbound-build-and-env.
- Any free-source `perSource` timestamp > 48 h old, or `lastErrors` non-empty → the cron is broken; fix that FIRST (load northbound-run-and-operate) — coverage work is meaningless while refresh is down.
- meetup docs > 0 → someone ran the paid actor since this baseline; check LOG.md for a matching entry and Apify billing before proceeding.
- Metric already ≥ 15 → the campaign may have been won by earlier phases; verify two consecutive cycles, update LOG.md, and stop here.

---

## Phase 1 — Free expansions (no approval needed; each gated by before/after measurements)

### 1a. Luma funnel: where luma coverage actually dies

```bash
node .claude/skills/northbound-coverage-campaign/scripts/luma-funnel.mjs
```

The script resolves every `LUMA_CITY_SLUGS` entry exactly like `fetchLumaEntries` (`lib/fetchers/luma.ts`) and prints feed → upcoming → relevance-pass, plus the upcoming events `isRelevant()` (`lib/fetchers/relevance.ts`) DROPS.

**Measured 2026-07-20:**

| slug | resolves to | feed | upcoming | relevance-pass |
|---|---|---:|---:|---:|
| toronto | discover-place `discplace-Cx3JMS6vXKAbhV5` | 39 | 39 | 8 |
| montreal | discover-place `discplace-CXKKcJmNkbj6ikW` | 26 | 26 | 2 |
| ottawa | **calendar** "Ottawa AI and Tech Community" | 0 | 0 | 0 |

Two findings, both verified 2026-07-20:

1. **The relevance INCLUDE regex is dropping real tech events** (false negatives observed in the DROPPED list): "OpenMTL - Personal Agents" (an agents meetup — `agentic` matches, bare `agents` does not), "Bitcoin Devleoper Conference - btcplusplus" (source typo defeats `developers?`), "Solana & Superteam Canada Mixer", the Toronto "DotDev" community events (bare `dev` is not in INCLUDE). Montreal passes only 2 of 26.
2. **Ottawa has zero luma supply**: the `ottawa` slug resolves to a community *calendar* (not a Luma discover place) that currently lists 0 future events. `fetchLumaEntries` handles the calendar kind, so nothing is broken — there is simply nothing there.

**Gate 1a:** if the DROPPED list contains ≥3 clearly-tech events (it did on 2026-07-20) → the highest-yield free change is widening `INCLUDE` in `lib/fetchers/relevance.ts`. This is a pipeline change: follow northbound-pipeline-engineering for mechanics and northbound-research-methodology for discipline (write the predicted pass counts BEFORE editing). Candidate tokens from the measured drops (candidates, not decisions): `agents?`, crypto-ecosystem names (`solana|ethereum|bitcoin` — weigh consumer-crypto noise), community-brand terms. Bare `dev` is high-risk (matches "dev" inside non-tech words is prevented by `\b`, but matches e.g. venue names). Acceptance:
- re-run `luma-funnel.mjs`: pass counts rise (Toronto toward ~12-15, Montreal toward ~4-6), and no yoga/pottery/dating event appears in the pass set;
- note the same gate filters eventbrite/meetup fetch results — a wider INCLUDE also widens future paid-run yield;
- `npx tsc --noEmit` clean; then after merge, metric re-measured across 2 cron cycles.

If instead the DROPPED list is genuinely non-tech → the luma city feeds are exhausted at ~10 events; skip to Phase 2.

**FENCED within 1a — Luma city-slug expansion is a measured dead end (probed 2026-07-20).** Every in-region candidate fails: `quebec-city`, `mississauga`, `markham`, `richmond-hill` → HTTP 404; `brampton`, `oakville`, `quebec`, `waterloo` → squatted by `kind: "event"` (fetchLuma would throw "unsupported kind"); `vaughan` → HTTP 301. No new Luma discover place exists inside the product region. Re-probe quarterly, not sooner:
```bash
for s in quebec-city mississauga markham vaughan brampton; do curl -s -o /dev/null -w "$s: %{http_code}\n" "https://api.lu.ma/url?url=$s"; done
# 404/301 = still dead; 200 → check kind with: curl -s "https://api.lu.ma/url?url=SLUG" | head -c 200
```

### 1b. Company-registry silent-dead audit

The company registry (`COMPANY_SOURCES`, `lib/fetchers/config.ts`) has **38 entries as of 2026-07-20** (9 bespoke + 28 luma + 1 tribe). Audit per-organizer yield:

```bash
node --env-file=.env.local -e "
import('mongoose').then(async ({default: m}) => {
  await m.connect(process.env.MONGODB_URI);
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const rows = await m.connection.db.collection('events').aggregate([
    {\$match:{source:'company'}},
    {\$group:{_id:'\$organizer',total:{\$sum:1},upcoming:{\$sum:{\$cond:[{\$gte:['\$date',today]},1,0]}},last:{\$max:'\$updatedAt'}}},
    {\$sort:{upcoming:-1,_id:1}}]).toArray();
  console.table(rows.map(r=>({org:r._id,total:r.total,upcoming:r.upcoming,last:r.last?.toISOString().slice(0,10)})));
  await m.disconnect();
});"
```

**Measured 2026-07-20:** 30 of 38 registry companies have docs. **Zero docs ever (8):** Tesla, Cohere, Hugging Face, Vercel, Perplexity, ElevenLabs, Linear, Notion Toronto. **Zero upcoming (6):** Cloudflare, Comet, Google, MaRS Discovery District, Render, Together AI.

**Gate 1b branches — distinguish "org quiet" from "adapter dead":**
- Tesla at zero is EXPECTED (`devOnly: true` → the `isRelevant` gate at scrape time; its consumer feed yields 0 dev events by design — `lib/scrape.ts`).
- For a zero-doc **luma-provider** company, probe its calendar directly (read-only):
  ```bash
  node -e "fetch('https://api.lu.ma/calendar/get-items?calendar_api_id=CAL_ID&period=future&pagination_limit=50',{headers:{'user-agent':'NorthboundBot/1.0 (+https://github.com/CodeOfGordon)'}}).then(r=>r.json()).then(j=>console.log((j.entries??[]).length+' future entries'))"
  ```
  Probed 2026-07-20: Cohere, Vercel, Hugging Face, Linear, Cloudflare all returned **0 future entries** → genuinely quiet calendars, not broken adapters. Keep them (each costs one cheap request per night; they self-populate when the org posts).
  - **>0 future entries but still 0 docs after the next cron** → adapter/wiring bug → load northbound-debugging-playbook, fix via northbound-pipeline-engineering.
- For a zero-upcoming **bespoke** adapter (Google is the watch item: 1 doc ever, last touched 2026-06-24), route to northbound-debugging-playbook — bespoke endpoints rot silently, and curl is an invalid smoke test for several of them (TLS-fingerprint 403s; see northbound-source-platforms-reference).
- Note the honest scope: registry fixes move the *company* lane and the all-lane city number (26), not the primary local-lane metric.

### 1c. Hackathon-source scoping check

```bash
node .claude/skills/northbound-coverage-campaign/scripts/devpost-local-gap.mjs
```

**Measured 2026-07-20:** Devpost's in-person open/upcoming slice totals 75; exactly **2** are in ON/QC — "GenZ Can Hack 2026" (Toronto, 143-day span → would ALSO fail `MAX_HACKATHON_DAYS = 120`, `lib/fetchers/config.ts`) and "Stupid Ideas Hackathon (Ottawa F26)" (single date "Sep 12, 2026" → `parseDevpostRange` in `lib/fetchers/companies/shared.ts` returns `null` for single-date strings, so `devpost.ts` skips it as "unparseable window").

**Gate 1c:** expected yield of building an in-person-CA Devpost slice is ~1-2 events — do NOT build it while Phase 1a/2 levers are unplayed. The one small real fix surfaced: `parseDevpostRange` rejects single-date hackathons even in the online slice (candidate: treat a single parseable date as `start === end` — route via northbound-pipeline-engineering; re-run this probe as the acceptance check). The other scopes are correct as designed: MLH keeps ON/QC + digital (`MLH_PROVINCES`), luma-hackathons keeps virtual-or-CA/US (`fetchLumaHackathons`, `lib/fetchers/luma.ts`), the 120-day span gate exists to drop perpetual "marathon" challenges (config comment).

---

## Phase 2 — New free sources (ranked menu; proof obligations BEFORE any code)

Every entry must clear the proof obligations below before an adapter is written — the recipes live in northbound-proof-and-analysis-toolkit; platform mechanics in northbound-source-platforms-reference:

1. robots.txt permits the endpoint (this project honors robots — see the GDG/Bevy fence below);
2. endpoint is public/unauthenticated (prove with a clean fetch, no cookies);
3. Node-fetch parity (curl passing is NOT sufficient, curl failing is NOT damning — Tesla/Databricks 403 curl but pass Node fetch);
4. ToS sanity (no login walls, no explicit scraping prohibition on the data used);
5. an expected-volume estimate written down BEFORE building (predictions-first, northbound-research-methodology).

**The lane-routing decision that shapes this whole phase:** the proven generic adapters (`luma` and `tribe` providers, `lib/fetchers/company.ts`) ingest via `COMPANY_SOURCES` → events land as `source: 'company'` → **Companies lane. The primary local-lane metric will not move.** To grow the *Local* lane with community Luma calendars, the pipeline needs a small change: a `LUMA_COMMUNITY_CALENDARS` list in `lib/fetchers/config.ts` fed into `fetchLuma` (so docs land `source: 'luma'`). That is a design decision — classify via northbound-change-control (likely an ADR), implement via northbound-pipeline-engineering. Decide the routing BEFORE adding the first community org, and record the decision in LOG.md.

Ranked by expected-yield-per-effort (as of 2026-07-20):

| # | Source class | Status | Effort | Expected yield | Notes |
|---|---|---|---|---|---|
| 1 | Luma calendars of Toronto/Ottawa/Montreal community tech orgs | **Open — no candidates verified yet** | Config-only per org (once routing decided) | Unknown until probed; Ottawa gap makes this the top lead | Per-candidate verification is MANDATORY — Luma vanity slugs are squatted (lu.ma/cohere is a coliving community). Recipe: resolve `api.lu.ma/url?url=<slug>`, confirm the calendar display name is really the org, pin `calendarApiId` (never bare slug), probe `calendar/get-items?period=future` for ≥1 entry. |
| 2 | WordPress "The Events Calendar" (tribe) instances of local orgs | **Open — Vector Institute is the proven precedent** | Config-only per org | Low-moderate | Probe: `curl -s 'https://SITE/wp-json/tribe/events/v1/events?per_page=5'` returns JSON with an `events` array → viable. Same lane-routing caveat (lands in company lane). |
| 3 | University eng/CS event calendars + public ICS feeds | **Candidate — new adapter class** | New fetcher + **ICS parser = new dependency → gordon's approval first** (northbound-change-control, dependency class) | Speculative | Clear all 5 proof obligations per feed before proposing. An ICS *input* parser is unrelated to the ICS *output* feed idea in northbound-research-frontier — don't conflate the approvals. |
| 4 | City open-data event feeds (Toronto/Ottawa/Montreal open-data portals) | **Speculative — no real candidate verified as of 2026-07-20** | Unknown | Unknown | Do not list as viable, plan, or build until a session verifies a specific dataset exists, is fresh, and actually contains upcoming tech events. Verification first, then re-rank. |

**Gate 2 (per candidate source):** all 5 proof obligations documented in LOG.md → classify the change via northbound-change-control → implement via northbound-pipeline-engineering → validate via Phase 4. A candidate failing ANY obligation is recorded in LOG.md as fenced, with the receipt.

## Fenced wrong paths — do not retry (the receipts)

| Path | Why it is fenced | Receipt |
|---|---|---|
| GDG/Bevy (`gdg.community.dev`) + CNCF community events | robots.txt disallows `/api/` for all agents — etiquette call, twice reaffirmed | `lib/fetchers/config.ts` header comment ("Still excluded: GDG/Bevy + CNCF"); ADR-010/ADR-013 in `.claude/docs/decisions.md` (June 2026) |
| Unbounded / input-capped-only Apify runs | June 2026 billing incident: a meetup run requested 20 items and billed ~10× the request (~$1.4–2; full numbers: `northbound-failure-archaeology` A4), exhausting the ~$5 free tier. Only the `?maxItems=` RUN OPTION caps billing | `lib/fetchers/apify.ts` `RunOptions` doc comment; commit 4d3317d |
| Broadening `MEETUP_KEYWORDS`/`MEETUP_SEARCH_URLS` while meetup is unverified AND paid | The meetup path has never been live-verified end-to-end (0 docs ever); widening a paid, unproven search multiplies spend against zero evidence. Also ~1 min/URL actor crawl vs the client's 280 s poll deadline (and the unresolved 60s-vs-300s hosted ceiling — `northbound-architecture-contract` W6) | `.claude/docs/decisions.md` "Known follow-ups"; `lib/fetchers/config.ts` MEETUP comment; Phase 3b decides meetup's fate first |
| Login-gated pages, or scraping against a site's ToS | Not who this project is; also fragile and unprovable | project-wide etiquette stance per ADR-010 |
| Luma city-slug expansion inside the region | Measured dead end — every candidate 404/squatted/redirect | Phase 1a probe table, 2026-07-20 |

---

## Phase 3 — Paid top-up decision gate (G1: STOP — gordon's explicit approval BEFORE any run)

No Apify actor run happens until gordon has approved a message that pre-declares ALL of:
1. actor name (`parseforge/eventbrite-scraper` or `easyapi/meetup-events-scraper` — `lib/fetchers/eventbrite.ts` / `meetup.ts`);
2. the run-option `maxItems` and `memory` values that will be sent (the code sends them automatically — state what they compute to under the chosen `SCRAPE_MAX_ITEMS`);
3. expected item count and a **cost ceiling read from the actor's current pricing page** (check via the Apify console or MCP `fetch-actor-details` at request time — do NOT reuse stale prices; the only price in-repo is the meetup $0.09/start comment in `meetup.ts`, which must be re-verified before quoting);
4. what it tops up (which cities/lane) and the before-measurement it will be compared against.

After ANY paid run: verify actual billing in the Apify console against the ceiling, and log both numbers in LOG.md. A run that bills over its declared ceiling is an incident — record it and stop further runs.

### 3a. Eventbrite top-up protocol (the practiced pattern)

Eventbrite runs one actor run per `EVENTBRITE_CITIES` slug (4 cities incl. Mississauga), per-city cap `max(5, floor(MAX_ITEMS/4))` (default `SCRAPE_MAX_ITEMS=50` → 12/city), memory 1024 MB. It is the only lever that currently reaches Ottawa/Quebec City in the Local lane at all.

```bash
# 1. approval per the gate above.  2. local machine, dev server up:
npm run dev
# 3. (optional) cap the run: set SCRAPE_MAX_ITEMS in .env.local, restart dev server.
# 4. BEFORE snapshot:
node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs
# 5. the run (local machine — deliberately not the hosted site; scrape.yml header documents this):
curl -X POST http://localhost:3000/api/refresh -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" -d '{"sources":["eventbrite"]}'
# 6. AFTER: source-health + coverage-report + Apify console billing check → LOG.md entry.
```

Expected shape of a healthy run (from the 2026-06-10 run, the only prior one): tens of docs across the 4 cities, `errors: []` in the JSON response, eventbrite `newest updatedAt` jumps to now. If the response reports `eventbrite: ...` errors or 0 upserts → stop (do not re-run; each retry bills) → northbound-debugging-playbook.

### 3b. Meetup: VERIFY-OR-RETIRE (owner decision — lay out both, gordon chooses)

Meetup has 0 docs ever: the June 2026 billing incident exhausted the credit mid-validation, so the fetcher's plumbing is code-verified but never live-verified. Two coherent options — **do not pick one yourself**:

**Option A — one capped verification run.** Set `SCRAPE_MAX_ITEMS=10` → run-option `maxItems=10`, memory 2048 MB, timeout 280 s (all sent by `meetup.ts`); declared cost = 1 start fee + ≤10 results at the actor's current per-result price (pricing-page check mandatory). Run via the 3a protocol with `{"sources":["meetup"]}`. **Success criterion (pre-declared):** ≥1 meetup doc lands with correct title/date/city → meetup is live-verified; keep it as an on-demand top-up. **Failure** (0 docs, garbage shape, or overbilling) → retire.
**Option B — retire the fetcher.** Delete `lib/fetchers/meetup.ts`, its `FETCHERS` entry (`lib/scrape.ts`), and `MEETUP_*` config; decide separately whether `'meetup'` leaves the Event-model `source` enum and `LOCAL_SOURCES` (schema + UI surface → northbound-pipeline-engineering + northbound-change-control; with 0 stored docs the enum removal has no data migration). Branch-first; gordon commits (G4).

Either outcome ends the "unverified paid path" limbo — that is the point.

---

## Phase 4 — Validation and promotion

- A new or changed source **graduates** only after passing the northbound-validation-and-qa acceptance thresholds on **two consecutive nightly cron cycles** (before/after source-health, no new `lastErrors`, no dedup regressions).
- **Company-registry additions need no ops change** — they ride the nightly `company` POST automatically.
- A **new top-level source** (a 7th `FETCHERS` entry) must be added to scrape.yml's free-source list in **two places** — the schedule branch (`sources=luma mlh hackathon company` in the "Pick sources" step) and the `workflow_dispatch` default. Editing scrape.yml is an ops change: classify via northbound-change-control first.
- **Campaign success**: metric > 5 (the 2026-07-20 baseline), sustained across ≥2 consecutive cron cycles, shown by `coverage-report.mjs` output pasted into LOG.md. Never judged by eye, never declared from a single night.

## Campaign log convention (LOG.md)

Append-only, newest last, in `.claude/skills/northbound-coverage-campaign/LOG.md`. One entry per decision or measurement:

```markdown
## 2026-MM-DD — <short title>
- Phase: <0-4> | Decision/Measurement: <one line>
- Command(s): <exactly what was run>
- Observed: <the numbers — paste the relevant script lines>
- Metric: <current value> (baseline 5)
- Next: <the branch taken>
```

LOG.md already contains the Phase 0 baseline entry (2026-07-20). Every future session working this campaign reads LOG.md first, appends its results, and never re-litigates a fenced path without new evidence.

## When NOT to use this skill

- Mechanics of writing/altering fetchers, adapters, config, schema, dedup → **northbound-pipeline-engineering**.
- "Is this change allowed / how is it classified / ADR needed?" → **northbound-change-control**.
- Running scrapes, cron babysitting, deploys, prod-DB etiquette → **northbound-run-and-operate**.
- Running/interpreting source-health, coverage-report, db-sanity in general (outside this campaign) → **northbound-diagnostics-and-tooling**.
- Proof recipes (robots checks, endpoint publicness, curl-vs-Node 403s, billing-cap proof) → **northbound-proof-and-analysis-toolkit**.
- Per-platform endpoint/anti-bot/date-semantics knowledge → **northbound-source-platforms-reference**.
- Acceptance thresholds and what "live-verified" means → **northbound-validation-and-qa**.
- A source is misbehaving (0 items, wrong cities, E11000) → **northbound-debugging-playbook**; prior incidents → **northbound-failure-archaeology**.
- Other open research fronts (dedup entity resolution, ICS output feeds, agent operability) → **northbound-research-frontier**; evidence discipline → **northbound-research-methodology**.
- UI presentation of lanes/filters → **northbound-frontend-engineering**.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit 63a965a + live read-only measurements (prod Atlas via the read-only path, api.lu.ma, devpost.com probes — all commands in this file were executed and their outputs recorded verbatim). Phase 0 numbers measured 2026-07-20; Luma/Devpost probe results measured 2026-07-20.

Volatile facts and their drift checks:

| Volatile fact (as of 2026-07-20) | Re-verify with |
|---|---|
| Baseline: metric 5; source docs/upcoming table above | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/coverage-report.mjs` (and source-health.mjs) |
| Nightly cron green; perSource timestamps ≈ yesterday | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs` (meta block) |
| `LUMA_CITY_SLUGS = ['toronto','montreal','ottawa']` | `grep -n "LUMA_CITY_SLUGS" lib/fetchers/config.ts` |
| `ottawa` slug → calendar "Ottawa AI and Tech Community", 0 future entries | `node .claude/skills/northbound-coverage-campaign/scripts/luma-funnel.mjs` |
| No in-region Luma discover slugs beyond toronto/montreal | the `for s in ... curl api.lu.ma/url` loop in Phase 1a |
| Luma funnel: toronto 39→8 pass, montreal 26→2 pass | `node .claude/skills/northbound-coverage-campaign/scripts/luma-funnel.mjs` |
| `COMPANY_SOURCES` has 38 entries; 8 orgs zero-docs-ever | `node -e "const s=require('fs').readFileSync('lib/fetchers/config.ts','utf8');console.log(s.match(/COMPANY_SOURCES[\s\S]*?^\];/m)[0].match(/provider: '/g).length)"` (expect 38) + the 1b aggregate |
| Devpost in-person ON/QC yield ≈ 2 | `node .claude/skills/northbound-coverage-campaign/scripts/devpost-local-gap.mjs` |
| Eventbrite per-city split & memory (12/city @ default, 1024 MB) | `sed -n '12,22p' lib/fetchers/eventbrite.ts` |
| Meetup run options (maxItems=MAX_ITEMS, 2048 MB, 280 s) and $0.09 start-fee comment | `sed -n '1,20p' lib/fetchers/meetup.ts` + actor pricing page at run time |
| scrape.yml free-source list in two places | `grep -n "luma mlh hackathon company" .github/workflows/scrape.yml` (expect 2 hits) |
| `LOCAL_SOURCES = ['luma','eventbrite','meetup']`; `laneOf` semantics | `grep -n "LOCAL_SOURCES" lib/events.ts`; `grep -n -A4 "export function laneOf" lib/constants.ts` |

The two scripts in `scripts/` import `isRelevant`, `LUMA_CITY_SLUGS`, `MAX_HACKATHON_DAYS`, and `parseDevpostRange` **live** from the pipeline source (Node ≥22.18 TS type-stripping; toolchain v22.22.2) — they track code changes automatically and abort loudly if the imports break. If Luma or Devpost change their endpoints, the scripts fail with HTTP errors rather than lying.
