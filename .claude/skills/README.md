# Skills Index — Northbound

Northbound is one deduplicated feed of official big-tech/AI company dev events,
hackathons, and Canada-first community tech events — auto-scraped from six source
families into MongoDB and served by a Next.js 16 App Router UI. The pipeline:
`cron → scrapers → normalize + dedup (fingerprint) → MongoDB → server pages → calendar export`.

This library is the project's operational knowledge base, written for
**zero-context sessions** (Sonnet-class agents and junior/mid engineers). It was
authored 2026-07-20 from verified repo state — every command and path was checked
against the code, and volatile facts are date-stamped. Each skill ends with a
**Provenance and maintenance** section containing one-line re-verification
commands; trust those over memory.

**Start here:**

- Touching anything? Load `northbound-change-control` first — the four hard gates
  ($0 hosting, sacred prod DB, PRODUCT.md/DESIGN.md as UI law, gordon-authored
  commits) bind every task.
- Something is broken? Load `northbound-debugging-playbook` first.
- New to the repo? `northbound-architecture-contract` → `northbound-build-and-env`.

## The 16 skills

| Skill | One-liner |
|---|---|
| `northbound-change-control` | The four hard gates, change classification, per-class checklists, ADR discipline. Load before any change. |
| `northbound-debugging-playbook` | Symptom→triage table for the real failure modes, each with a first check and a discriminating experiment. |
| `northbound-failure-archaeology` | The incident chronicle — every investigation, dead end, and removal, so settled battles aren't re-fought. |
| `northbound-architecture-contract` | System shape, the 17-ADR digest, the invariants you must not break, the known-weak points stated plainly. |
| `northbound-source-platforms-reference` | Domain reference: how Luma/MLH/Devpost/DoraHacks/ETHGlobal/company platforms/Apify actually expose data; anti-bot, date/tz, geo, dedup theory. |
| `northbound-pipeline-engineering` | Runbook for scraper/normalization/schema/dedup/config changes. Replaces the retired legacy skills. |
| `northbound-frontend-engineering` | Runbook for UI/API-surface work: pages, filter-state contract, lanes, scroll-perf conventions, design compliance, calendar export, PostHog. |
| `northbound-build-and-env` | Recreate the environment from scratch; env-var catalog; the `test`-database trap; toolchain facts. |
| `northbound-run-and-operate` | Dev runs, scrape triggering, the nightly cron, deploy, freshness, prod-DB etiquette, paid-source protocol. |
| `northbound-diagnostics-and-tooling` | Measure instead of eyeball: shipped read-only scripts (`source-health`, `coverage-report`, `db-sanity`, `screenshot`) with interpretation guides. |
| `northbound-validation-and-qa` | The evidence bar, live-verified inventory, acceptance thresholds, honest test-suite state, the candidate test plan. |
| `northbound-docs-and-writing` | Maintaining the docs of record; templates; house style; the stale-docs fix list; public-claims discipline. |
| `northbound-coverage-campaign` | The executable, decision-gated campaign against the hardest live problem: local coverage decay at $0. Has a running `LOG.md`. |
| `northbound-proof-and-analysis-toolkit` | First-principles proof recipes (endpoints, anti-bot, billing caps, dates, perf, contrast, explain plans), each with a worked repo example. |
| `northbound-research-frontier` | The four open fronts (entity resolution, coverage at $0, ICS feeds, agent-operability) with first steps and falsifiable milestones. |
| `northbound-research-methodology` | How a hunch becomes an accepted change: evidence bar, predictions-first, idea lifecycle, adversarial refutation. |

## Third-party skills (not part of this library)

- `impeccable` — installed frontend-design skill (`pbakaus/impeccable`, tracked in
  `skills-lock.json`). Note: its SKILL.md hardcodes `.agents/skills/...` script
  paths; in this repo the scripts live under `.claude/skills/impeccable/scripts/`.
- `integration-nextjs-app-router` — PostHog wizard artifact; the integration it
  describes is already completed (`instrumentation-client.ts` + `/ingest` rewrites).

## Retired

The nine pre-implementation skills (`event-scraping`, `apify-actors`,
`data-schema`, `deduplication`, `database`, `backend-api`, `frontend`,
`calendar-button`, `scheduling`) were authored before the code existed and had
drifted badly (SWR never installed, Luma-via-Apify superseded by ADR-009, Mongoose
`FilterQuery` removed in v9, a `vercel.json` cron that never existed). On
2026-07-20 each was replaced in place with a RETIRED tombstone redirecting to its
successor; their still-true content lives in the `northbound-*` successors **each
tombstone names** — chiefly `northbound-pipeline-engineering`,
`northbound-frontend-engineering`, `northbound-source-platforms-reference`,
`northbound-run-and-operate` (scheduling/backend-api), `northbound-build-and-env`
(database), and `northbound-architecture-contract` (data-schema/deduplication).
The directories can be `git rm`'d outright at the owner's discretion; originals
are recoverable via git history.

## Provenance and maintenance

Authored 2026-07-20 (skill-library build; discovery + authoring + adversarial
review by multi-agent workflow, verified against repo state and the live DB).

| Volatile fact | Re-verify with |
|---|---|
| This index lists exactly the skills on disk | `ls .claude/skills/` |
| Skill descriptions match frontmatter | `head -3 .claude/skills/northbound-*/SKILL.md` |
