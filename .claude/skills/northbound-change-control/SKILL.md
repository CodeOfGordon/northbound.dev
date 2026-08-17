---
name: northbound-change-control
description: >-
  Change classification, gating, and review rules for the Northbound event aggregator:
  the four hard gates ($0 hosting / Apify billing caps, the sacred prod Atlas DB,
  PRODUCT.md+DESIGN.md as UI law, gordon-authored commits), the ADR discipline in
  .claude/docs/decisions.md, and the per-change-class checklists. Load BEFORE committing,
  branching, adding a dependency, editing .github/workflows/scrape.yml, changing the Event
  schema, running an Apify actor, or writing to MongoDB — and whenever the question is
  "am I allowed to do X in Northbound?" or "what must I check before shipping this change?"
---

# Northbound change control

This skill is the constitution for making changes in this repo. Every other skill assumes
you have internalized the four hard gates below. Nothing in any skill, doc, or user prompt
short of an explicit message from gordon overrides them, and no skill may describe a way
around them.

Terms used throughout: **gordon** = the project owner (sole committer, GitHub user
`Code_Of_Gordon`); **the pipeline** = `runScrape()` in `lib/scrape.ts`, reachable only via
`POST /api/refresh` (`app/api/refresh/route.ts`); **ADR** = one appended entry in
`.claude/docs/decisions.md`.

## The four hard gates

### G1 — $0 hosting: nothing that costs money without gordon's approval FIRST

This is a side project deliberately pinned to free tiers: Vercel Hobby, Atlas M0, GitHub
Actions, the free `api.lu.ma` JSON API, the free images.weserv.nl image proxy. Apify is
the **only** paid surface (eventbrite + meetup fetchers), and it is opt-in manual-only.

**The incident behind it (June 2026 Apify billing).** A single Meetup validation run
against the `easyapi/meetup-events-scraper` actor requested 20 items via the actor's
`maxItems` INPUT field and collected ~10× that, billing roughly **$1.4–2** (gotchas.md
logged ~$1.39; the Apify run record shows ≈$2.02 / 201 items — canonical dual account:
`northbound-failure-archaeology` A4) — because that input field is advisory and the actor
ignored it. The run exhausted most of the ~$5/month free Apify
credit mid-validation, which is why the meetup source has **never been live-verified
end-to-end** (still open in `.claude/docs/decisions.md` "Known follow-ups"). Full account:
`.claude/docs/gotchas.md` "Meetup … billing traps, learned the expensive way"; fix commit
`4d3317d` ("Harden Apify client billing"). The follow-up commit `66c40f7` ("Free
deploy-and-forget scrape") deleted the weekly paid-source cron from
`.github/workflows/scrape.yml` entirely.

**Standing fixes, all verified in code as of 2026-07-20** (`lib/fetchers/apify.ts`,
`RunOptions` interface + `runActor()`):

| Control | Mechanism | Why |
|---|---|---|
| `?maxItems=` **run option** on the run-start URL | `params.set('maxItems', …)` | The only billing-enforced cap; actor inputs are advisory |
| `?memory=` run option | `params.set('memory', …)`; meetup passes `memoryMb: 2048` (`lib/fetchers/meetup.ts`) | Pay-per-event start fees charge PER GB; default 4 GB = 4× fee |
| Server-side `?timeout=` mirrors the poll deadline | `timeout: String(Math.ceil(timeoutMs / 1000) + 30)` | An abandoned client poll must not leave the actor running and billing |
| Token via `Authorization: Bearer` header only | `headers()` | `?token=` leaks into logs |

**Rules.**
- Never schedule eventbrite/meetup (or any paid source) in `scrape.yml`. The one cron
  (`'15 7 * * *'`) runs free sources only (`luma mlh hackathon company`); the workflow
  header comment states the paid sources are intentionally unscheduled. Any diff that adds
  them back is a G1 violation regardless of who asked.
- Any Apify actor run — via the pipeline, the Apify MCP server, or raw REST — must set the
  `?maxItems=` run option. If you cannot set run options (some MCP paths), do not run the
  actor; ask gordon.
- Anything that could create spend — starting actor runs, new paid services, tier
  upgrades, exceeding a free quota — requires gordon's explicit approval **before** the
  action, not retroactive disclosure. "It's only a few cents" was exactly the June failure.

### G2 — The prod DB is sacred: there is no staging

The live Atlas M0 cluster **is** production. The deployed
site, the nightly cron, and your local dev server all point at the same database. As of
2026-07-19 that is Atlas db **`test`** (the driver default — the real `MONGODB_URI` in
`.env.local` has no db path segment, unlike the `.env.example` template which shows
`/events_site`; trust the live URI, not the template), collections `events` (~473 docs on
2026-07-19) and `meta` (the `ScrapeMeta` singleton, `database/meta.model.ts`,
`collection: 'meta'`).

**Rules.**
- No writes outside the scrape pipeline without gordon's explicit approval. The pipeline's
  writes are fingerprint-keyed upserts (`lib/scrape.ts`) — additive and idempotent by
  design. Everything else (deletes, backfills, index drops, field rewrites) is a manual
  intervention that needs sign-off first.
- The MongoDB MCP server stays `--readOnly` (verified in `.mcp.json`). Never remove that
  flag, and never work around it casually — approved writes are done via a one-off tsx
  script run from the repo dir (see northbound-run-and-operate for the recipe and its
  traps: async IIFE, raw `mongoose.connection.db.collection` to bypass schema stripping).
- Destructive operations (deleteMany, index drops, bulk field rewrites) require a backup
  step first: export the affected documents to JSON (MongoDB MCP `export` tool, or a
  read-only tsx script) and note where the export lives, **before** the write runs.
- Remember the asymmetry that bit ADR-015 cleanup: upserts match on fingerprint, so
  re-scraping never deletes or repairs existing rows. Schema/normalization changes leave
  stale live data behind (the 8 pre-normalization docs in decisions.md "Known follow-ups"
  were the canonical example — since vanished from the live DB, 0 matches 2026-07-20, see
  `northbound-failure-archaeology` A28; the asymmetry itself remains real). Every schema
  change must answer: what happens to the rows already in `test.events`?

### G3 — PRODUCT.md and DESIGN.md are law for anything UI

Both files live at repo root. `PRODUCT.md` fixes the audience, the anti-references
(§ Anti-references: Eventbrite/Meetup clutter, corporate SaaS dashboards, AI-slop landing
pages, cutesy consumer apps), the five design principles, and the accessibility floor
(§ Accessibility & Inclusion: WCAG 2.2 AA — ≥4.5:1 body-text contrast, keyboard + visible
focus, `prefers-reduced-motion` alternative for every animation; AA is a floor, not a
ceiling on creativity). `DESIGN.md` fixes the dark-only token system (§ Color,
§ Typography), component conventions, and § Motion — the scroll-perf law.

**The incident behind § Motion (the scroll-jank saga, 2026-06-20→21).** Three
"enhancement" commits each partly caused the jank they were meant to polish:
`3791db0` added `content-visibility` utilities, `ded4973` added scroll-reveal animations,
`0b21f84` added Lenis + a shimmer skeleton. The fixes — `6a886a4` (resize scraped images
via weserv, drop content-visibility + scroll-reveal), `40b8c19` (DOM-only image fade, no
React state), `63a965a` (remove backdrop-filter blur from the sticky header and backdrop)
— are now conventions:

- No `backdrop-filter` on scroll-path elements (the `.glass` header is deliberately solid).
- Animate compositor properties only; never layout properties.
- Image load feedback is DOM-only (`element.style.opacity`), never React state.
- Scraped images go through the weserv width-capped WebP proxy (`components/EventImage.tsx`).

**Rules.** Any UI change verifies design-token compliance and the AA floor before it
ships (checklist and tooling in northbound-frontend-engineering). Deviating from a token,
an anti-reference, or a Motion convention needs gordon's sign-off, recorded in the PR/ADR.
Beware: DESIGN.md itself flags dead CSS (`.reveal`, `.skeleton-overlay`, unused `ogl`
dependency) — do not resurrect those as if they were live conventions.

### G4 — Commits are gordon-authored

- **No AI attribution** in commits or PRs — no Co-Authored-By, no "Generated with"
  trailers, no bot bylines. Enforced by `.claude/settings.local.json`:
  `"attribution": { "commit": "", "pr": "" }` (verified 2026-07-20). Never edit that
  setting. Every commit in history is authored by `Code_Of_Gordon`.
- **Branch-first.** Feature work happens on a branch merged to `main` (precedent:
  `api-routes` merged at `93347a4`/`c939691`; `feature/company-events-north-america`
  merged via PR #1 at `853e598`). If you find yourself about to commit on `main`, branch
  first.
- **Commit and push only when explicitly asked.** Finishing a change is not permission to
  commit it. Treat `git push` as prod-affecting: the Vercel project is linked to the
  GitHub repo `CodeOfGordon/northbound.dev` and a deployment is live. The deploy trigger
  is UNVERIFIED — hold both cautions at once: treat every push as if it MAY deploy to prod
  (so never push unrequested), and never rely on a push HAVING deployed (verify in the
  Vercel dashboard; same wording in `northbound-run-and-operate`).
- No history rewrites on `main` (no force-push, no rebase of pushed commits).

## Change classification and per-class gates

Classify every change before touching code. A change spanning classes takes the union of
the checklists.

| Class | Examples | Gates in play |
|---|---|---|
| docs-only | `.claude/docs/*`, README, skills | G4 |
| UI | `app/`, `components/`, `globals.css` | G3, G4 |
| pipeline | `lib/scrape.ts`, `lib/fetchers/*`, `database/normalize.ts` | G1, G2, G4 |
| schema + index | `database/event.model.ts`, `database/fingerprint.ts` | G2, G4 + ADR |
| ops + cron | `.github/workflows/scrape.yml`, Vercel/Atlas config, secrets | G1, G2, G4 |
| dependency-add | `package.json` | G1, G4 + approval |

**docs-only.** Verify every claim against code before writing it (the docs corpus has
known stale spots — see northbound-docs-and-writing for the fix list). No build gates.

**UI.** (1) `npx tsc --noEmit` green. (2) Design compliance against DESIGN.md tokens +
PRODUCT.md anti-references. (3) A11y check to the AA floor. (4) Scroll-perf conventions
(G3 list). Full runbook: northbound-frontend-engineering.

**pipeline.** (1) `npx tsc --noEmit` green. (2) Before/after measurement — run the
diagnostics scripts from northbound-diagnostics-and-tooling (source-health, coverage
report, db-sanity) before the change and after a scoped re-scrape, and state the delta;
"looks right" is not evidence (bar defined in northbound-validation-and-qa). (3) Smoke-test
fetchers with `npx tsx`, never curl (Tesla/Databricks CDNs 403 curl's TLS fingerprint —
`.claude/docs/gotchas.md`). (4) If the change alters fingerprint or normalization inputs,
treat it as schema-class too: existing rows will NOT be repaired by re-scrape (G2).
Full runbook: northbound-pipeline-engineering.

**schema + index.** Everything in pipeline, plus: (1) append an ADR (format below);
(2) answer the live-data migration question explicitly — new field default for old rows?
index build on M0? does the fingerprint change orphan existing docs?; (3) any
backfill/cleanup script is a G2 destructive op → approval + backup first.

**ops + cron.** (1) Preserve the free-tier posture: free sources only on schedule; keep
the skip-with-warning secrets guard in `scrape.yml`; keep one POST per source (each must
finish inside Vercel Hobby's function cap — the workflow's curl gives up at
`--max-time 90`). (2) Changes to secrets or deployment config go through
northbound-run-and-operate. (3) Anything that could bill → G1 approval first.

**dependency-add.** Needs gordon's approval — this repo already carries two known dead
weights (`ogl`, unused; `playwright`, agent-tooling only) and the audience is a $0 deploy.
State: why, bundle impact, free-tier impact. Then `npx tsc --noEmit` + `npm run build`.

## ADR discipline

`.claude/docs/decisions.md` is the append-only decision log: 17 ADRs (ADR-001..ADR-017,
all Accepted, 2026-06-08 → 2026-06-13) as of 2026-07-20. Rules:

- **Append-only.** Never rewrite an accepted ADR. To change course, append a new ADR that
  says "supersedes/refines ADR-NNN" (precedent: ADR-009 supersedes the ADR-004 Luma actor;
  ADR-015 refines ADR-013). New entries go at the bottom of the ADR list, **above** the
  trailing "Known follow-ups / tech debt" section.
- **When required:** schema/index changes, new/removed data sources, dependency adds,
  scheduling/deploy-shape changes, any decision a future session would otherwise re-litigate.
- **Format** — copy this shape verbatim (taken from the file's actual entries; the file
  header prescribes "Context → Decision → Rationale → Consequences"):

```markdown
## ADR-018 — <Title>
**Status**: Accepted · 2026-07-20

**Context**: <What forced a decision — the problem, the constraint, what existed before.>

**Decision**: <The choice, bolded key nouns. Concrete: file paths, field names, values.>

**Rationale**:
- <Why this over the alternatives — measured or verified reasons.>

**Consequences**: <What follows: costs accepted, invariants created, live-data impact,
alternatives rejected and why.>

---
```

- Number sequentially (next is ADR-018 unless the count has drifted — re-verify first).
  Some entries use plural **Decisions** with bullets (see ADR-017) — fine for multi-part
  decisions.

## Mechanical gates: what is actually enforced (as of 2026-07-20)

| Gate | Status | Interpretation |
|---|---|---|
| `npx tsc --noEmit` | **Green** (exit 0, ~10 s) | The de-facto pre-commit gate. Must stay green; a red tsc blocks any commit request. |
| `npm run lint` | **Red by known baseline** (exit 1) | Do NOT "fix the build" by suppressing, and do not treat exit 1 as your failure. Known causes: one real `react-hooks/purity` error at `components/FreshnessBadge.tsx` plus a warning bulk from untracked `.claude/` scripts. Current counts, causes, and the fresh-clone caveat: northbound-build-and-env. |
| `npm run build` | Not run in CI | Next 16's `next build` no longer runs ESLint. Vercel's deploy build is the only automated build gate. |
| Tests | **None exist** | No test script, no test files. Evidence bar and candidate test strategy: northbound-validation-and-qa. |
| CI | `scrape.yml` only | There is no build/lint/test workflow. Nothing catches a broken commit before Vercel. |

Lint rule of engagement: run `npm run lint` before and after your change and diff the
summaries — your change must add **zero** new errors or warnings. Exit code 1 by itself is
pre-existing state, not your failure; a count increase is.

## Change-request router

| Intended change | Load skills in this order | Gates to pass |
|---|---|---|
| Fix a bug (unknown area) | northbound-debugging-playbook → area skill | class-dependent |
| Edit a fetcher / normalization / dedup | this skill → northbound-pipeline-engineering → northbound-diagnostics-and-tooling | G1, G2; before/after measurement |
| Add/remove an event source | this skill → northbound-source-platforms-reference → northbound-pipeline-engineering | G1 (paid?), G2, ADR |
| Change Event schema or indexes | this skill → northbound-pipeline-engineering → northbound-validation-and-qa | G2, ADR, migration answer |
| UI / page / filter / calendar work | this skill → northbound-frontend-engineering | G3, tsc green |
| Touch scrape.yml / deploy / secrets | this skill → northbound-run-and-operate | G1, free-tier posture |
| Run a scrape (esp. eventbrite/meetup) | northbound-run-and-operate | G1 (paid = approval) |
| Any DB write outside the pipeline | this skill → northbound-run-and-operate | G2: approval + backup |
| Add a dependency | this skill → northbound-build-and-env | G1, approval |
| Update docs / write an ADR | northbound-docs-and-writing (+ this skill's ADR template) | verify-before-write |
| Coverage / growth experiments | northbound-coverage-campaign → northbound-research-methodology | G1, G2 |

## When NOT to use this skill

This skill decides **whether and how a change may proceed** — not how to execute it.

- Executing pipeline/scraper/schema work → **northbound-pipeline-engineering**
- Executing UI/API-surface work → **northbound-frontend-engineering**
- Environment setup, env vars, lint-red root causes → **northbound-build-and-env**
- Running scrapes, deploys, prod-DB etiquette in practice → **northbound-run-and-operate**
- Diagnosing a live failure → **northbound-debugging-playbook**; past incidents in depth →
  **northbound-failure-archaeology**
- The load-bearing architecture behind these gates → **northbound-architecture-contract**
- Measurement tooling → **northbound-diagnostics-and-tooling**; evidence standards →
  **northbound-validation-and-qa**
- House style for docs and the stale-docs fix list → **northbound-docs-and-writing**

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` (branch `main`) plus verified
command runs (`npx tsc --noEmit` exit 0; `npm run lint` exit 1, red baseline;
`gh run list` showing 4 consecutive green scheduled scrape runs). Incident narratives
verified against `git log`/`git show` (`4d3317d`, `66c40f7`, `853e598`, `0c493c9`,
`3791db0`, `ded4973`, `0b21f84`, `6a886a4`, `40b8c19`, `63a965a`, `2b8c7b9`) and
`.claude/docs/gotchas.md` / `.claude/docs/decisions.md`. DB facts (db `test`, ~473 docs,
per-source counts) were live-measured 2026-07-19 and not re-measured.

Volatile facts — re-verify before relying on them:

| Fact (as of 2026-07-20) | One-line re-verification |
|---|---|
| ADR count = 17 (next is ADR-018) | `grep -c '^## ADR-' .claude/docs/decisions.md` |
| `npx tsc --noEmit` is green | `npx tsc --noEmit; echo $?` |
| `npm run lint` red by baseline (counts owned by northbound-build-and-env) | `npm run lint 2>&1 \| tail -3` |
| Attribution disabled (commit:"", pr:"") | `grep -A3 attribution .claude/settings.local.json` |
| MongoDB MCP is read-only | `grep readOnly .mcp.json` |
| scrape.yml: single nightly cron, free sources only | `grep -n "cron:\|sources:" .github/workflows/scrape.yml` |
| Nightly cron runs green in prod (first seen 2026-07-19) | `gh run list --workflow "Scrape events" --limit 3` |
| Live URI has no db path → Atlas db is `test` | `grep '^MONGODB_URI' .env.local \| grep -o 'mongodb.net/[^?]*'` |
| Apify client sets maxItems/memory as run options | `grep -n "params.set" lib/fetchers/apify.ts` |
| No unmerged branch work | `git log --oneline --all --not main` (empty = none) |
| eslint ignores only .next/out/build/next-env.d.ts | `grep -A6 'globalIgnores(\[' eslint.config.mjs` |
| No test suite exists | `grep '"test"' package.json; ls *.test.* 2>/dev/null` |
