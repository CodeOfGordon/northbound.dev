---
name: northbound-research-methodology
description: How a hunch becomes an accepted change in Northbound (the event-aggregator repo) — the evidence bar (one mechanism must explain ALL observations), predictions-before-runs, the hunch→gotchas-note→experiment→ADR-or-retirement lifecycle, adversarial refutation, and how to run an experiment here safely. Load when proposing a fix whose cause is uncertain, investigating a bug with multiple candidate causes, planning any scrape/actor/perf experiment, deciding whether an idea deserves an ADR, or retiring a feature/dependency.
---

# Northbound research methodology: hunch → accepted change

This is the discipline that separates "I changed something and the symptom went away" from
"I identified the mechanism and proved it." Northbound's history contains both kinds of work;
the second kind is the standard. Terms used below: an **ADR** is an entry in
`.claude/docs/decisions.md` (17 entries ADR-001..ADR-017 as of 2026-07-20, format
Context → Decision → Rationale → Consequences, `**Status**: Accepted · date`);
**gotchas.md** is `.claude/docs/gotchas.md`, the append-mostly trap catalog that serves as
institutional memory between sessions.

## 1. The evidence bar

**A fix is accepted only when ONE stated mechanism explains ALL observations — including the
negative ones (what did NOT happen, who was NOT affected).** A fix that merely makes the
symptom less frequent has not met the bar; it has removed one contributor and proven nothing
about the rest.

### Positive example: the normalizeDate UTC-shift bug (single mechanism, full explanation)

- Symptom: evening events appeared on the **next** day after normalization.
- Mechanism found: `normalizeDate` did a naive UTC date-split (`toISOString().split('T')[0]`),
  so any event whose local wall-clock time crossed UTC midnight rolled forward a day.
- Why it met the bar — the one mechanism explained every observation, including negatives:
  - Evening Toronto events (UTC-4/-5) shifted; morning/noon events did **not**.
  - Sources emitting ISO timestamps with offsets shifted; plain `YYYY-MM-DD` strings did **not**.
- Fix: extract wall-clock parts in the event's IANA timezone via `Intl.DateTimeFormat`
  (`partsInZone` in `database/normalize.ts`; note its comment "an 8 PM Toronto event with a
  -04:00 offset must not roll to the next day"). Date-only strings are read back with *local*
  getters — pushing them through a zone conversion is exactly what used to shift the day.
- Commit trail: `3458ad6` documented the bug in gotchas.md **before** the fix existed
  (2026-06-09); `58d715e` shipped the fix one day later ("timezone-aware
  normalizeDate/normalizeTime (fixes the UTC day-shift bug)").

### Negative example: the scroll-jank saga (every single-cause theory was wrong)

Fast-scroll lag on the event feed. Initially suspected to be hosting/server-side — the
`6a886a4` commit message opens: "Big lag spikes on fast scroll were client-side paint cost,
not hosting". Several mechanisms contributed (#1 full-res image decode/paint — the dominant
cost; #2 `content-visibility` churn fighting Lenis's rAF loop; #3 scroll-reveal animations;
#4 React-state image-fade re-render cascades; #5 sticky-header/backdrop `backdrop-filter`
blur), and three of them had been **added by earlier commits that were themselves trying to
make scrolling smoother**. Each single-cause fix helped but did not cure; the cure required
removing one variable per commit until every contributor was identified. **The
commit-by-commit chronicle has ONE home: `northbound-failure-archaeology` A23** — the
six-commit chain `3791db0`→`63a965a` (interleaved with the unrelated `66c40f7`; verify with
`git log --oneline 3791db0^..63a965a`). Method caveat: `6a886a4` bundled several changes at
once (image resize + cv-* removal + reveal removal), so its per-mechanism attribution is
coarser than the one-variable-per-commit ideal.

Lessons encoded as rules:

1. **Partial improvement is evidence of a compound cause, not of a correct theory.** If your
   fix helps but does not cure, say so explicitly and keep hunting — do not declare victory.
2. **Remove one variable per commit** so each mechanism gets its own attributable evidence.
   The commit chain IS the experiment log.
3. **Your own recent "improvements" are suspects.** Three of the five mechanisms were shipped
   as enhancements (`3791db0`, `ded4973`, `0b21f84`) in the days immediately preceding the
   investigation.

Full incident write-ups (this saga and others) live in **northbound-failure-archaeology**;
this skill only extracts the method.

## 2. Predictions before runs

**Declare expected numbers BEFORE any run, and treat surprise as signal — not noise to
explain away.** The June 2026 Apify billing incident happened precisely at the one place no
cost prediction was declared: a 12-URL Meetup actor run "capped" at 20 items via the actor's
`maxItems` *input* (advisory — the actor ignored it) collected ~10× that and billed
~$1.4–2 (the canonical dual account of the cost figures is `northbound-failure-archaeology`
A4), exhausting most of the ~$5/month free credit and leaving the meetup source never
live-verified end-to-end (still true as of 2026-07-20; see gotchas.md "maxItems INPUT field
is advisory"). The billing-enforced cap that fixed it is the `?maxItems=` **run option** on
the start request (`4d3317d`; `lib/fetchers/apify.ts` `RunOptions`). Had "this run costs at
most X" been written down first, the discrepancy would have been caught at item 21, not
after ~200.

Declare-before-you-run table:

| Before you… | Declare | Then read the actual from |
|---|---|---|
| Trigger a scrape | Expected `upserted` + `modified` per source (a re-run of an unchanged source should upsert ~0 and modify ~N; a first run upserts up to `SCRAPE_MAX_ITEMS`, default 50) | The `POST /api/refresh` JSON response: `{ ok, sources, upserted, modified, errors, ranAt }` |
| Run any Apify actor | Hard cost ceiling: the `?maxItems=` run option value AND `memoryMb` (start fees charge per GB) — **gordon must approve any paid run first** (gate G1, see northbound-change-control) | The Apify run record + dataset item count |
| Change upsert/normalization logic | Expected doc-count delta and which sources' counts move | `mcp__mongodb__count` on `test.events` (the MCP is `--readOnly`, safe) before vs after |
| Change a fetcher | Expected raw item count from a probe script (section 6) before wiring it in | The probe's own output, then the scrape response |

Baselines to predict against (discovery-measured 2026-07-19, DB `test`, 473 event docs):
company 255, hackathon 139, luma 33, eventbrite 29, mlh 17, meetup 0. Re-measure with the
diagnostics scripts (**northbound-diagnostics-and-tooling**) rather than trusting these.

When the actual diverges from the declared number, the run has produced its most valuable
output: a falsified assumption. Investigate the divergence before shipping anything.

## 3. The idea lifecycle

As practiced in this repo:

```
hunch → gotchas.md note OR branch experiment → live verification with recorded numbers
      → ADR in .claude/docs/decisions.md (Status: Accepted), code + docs updated together
      → OR documented retirement (removal commit + doc update + residue cleanup)
```

- **Hunch stage**: cheap capture. `3458ad6` wrote the UTC-shift bug into gotchas.md a full
  day before the fix — the note alone made the eventual fix trivially reviewable. If the
  hunch needs code to test, branch first (gate G4 — see **northbound-change-control**).
- **Verification stage**: live numbers, not vibes. ADR-009 exists because `api.lu.ma` was
  probed and answered unauthenticated JSON "~2 s for all cities" — a recorded measurement.
- **Acceptance stage**: an ADR with Context → Decision → Rationale → Consequences, appended
  to `.claude/docs/decisions.md` (next number: ADR-018 as of 2026-07-20), with code and docs
  landing together. Docs updated later = docs never updated: gotchas.md still claims a weekly
  paid cron (line "the cron runs paid sources weekly") that `66c40f7` deleted from
  `scrape.yml`. See **northbound-docs-and-writing** for the docs-of-record list.
- **Retirement stage**: killing an idea is a first-class outcome. It gets the same rigor as
  adoption — a removal commit that states why, plus doc updates, plus residue cleanup.

### Healthy retirements to imitate (all verified in git)

| What was retired | Commit | Why |
|---|---|---|
| WebGL LightRays backdrop (452-line `components/LightRays.tsx`, ogl-based) | `0c493c9` | Heavy; replaced by static CSS `components/Backdrop.tsx` for the calmer aesthetic |
| `content-visibility` utilities + scroll-reveal usage | `6a886a4` | Both *caused* the jank they were meant to smooth (mechanisms #2/#3 above) |
| Weekly paid-source cron (`45 7 * * 0` in `scrape.yml`) | `66c40f7` | Incompatible with $0 hosting; paid sources became manual-only |
| Sticky-header backdrop blur + Backdrop filter blur | `63a965a` | Per-frame re-compositing cost (mechanism #5) |

### The anti-pattern: retiring code but leaving residue

Every retirement above left droppings that still mislead readers as of 2026-07-20:

- `app/globals.css` still defines `.reveal` (+ `@keyframes reveal-up`), `.skeleton-overlay`,
  and the `cv-card`/`cv-row` `@utility` blocks — **zero consumers** in `app/` or
  `components/` (grep them yourself). A reader of globals.css wrongly concludes these
  features are active.
- `package.json` still lists `ogl` as a dependency; its only consumer died in `0c493c9`.
- `components/SmoothScroll.tsx`'s doc comment still claims Lenis keeps "the scroll-driven
  reveal animations" working — removed one commit later.

**Rule: when you retire a mechanism, grep for every artifact it introduced (CSS, deps,
comments, doc claims) and remove them in the same commit.** Whether to clean up the residue
listed above now is an open question for gordon (it is uncommitted-work-adjacent); do not
delete it silently as a drive-by.

## 4. Adversarial refutation

Before adopting a mechanism claim, state it falsifiably and try to kill it:

```
CLAIM:      <one mechanism, one sentence>
EVIDENCE:   <observations it explains — including the negatives>
REFUTER:    <the concrete observation that would DISPROVE it>
```

Then assign a **fresh session/agent** — one with no investment in the theory — to hunt for
the refuting observation. Adopt only if refutation fails. The scroll-jank saga shows
refutation working as designed: "the lag is full-res images" predicted that width-capped
WebP would cure it; residual stutter after `6a886a4` **refuted images-as-sole-cause** and
forced the hunt that found the onLoad re-render cascade (`40b8c19`).

This mirrors how the discovery behind this skill library was built: doc claims were
adversarially cross-checked against code by fresh read-only sessions (2026-07-19),
surfacing dozens of doc-vs-code contradictions — e.g. CONTEXT.md claiming the FETCHERS
registry "is empty" while `lib/scrape.ts` registers all six sources; four separate docs
describing a weekly paid cron that `scrape.yml` does not contain; the legacy
pre-implementation skills prescribing SWR (never installed) and Mongoose `FilterQuery`
(removed in v9 — it is `QueryFilter`).
**A doc claim, a memory note, or your own prior conclusion is a CLAIM, not evidence.
Fresh eyes + grep beat trust.** The audit itself left no repo artifact — the surviving,
confirmed records are **northbound-failure-archaeology** A26/A27 and the
**northbound-docs-and-writing** fix list; re-derive anything beyond those with grep rather
than citing the audit.

## 5. Where good ideas historically came from

Look in these places first — each earned its spot:

| Habit | Worked example (verified) |
|---|---|
| **The platform's own docs over guessing.** This repo runs a modified Next 16; its bundled docs beat training data. | `node_modules/next/dist/docs/01-app/` exists and is the Next source of truth here. The Apify billing fix came from Apify's run-API surface (`POST /v2/acts/{id}/runs?maxItems=N` — the enforced cap), not from the actor's README, whose `maxItems` input the actor ignored. |
| **Live-probe endpoints before writing adapters.** | ADR-009: while verifying the planned paid Luma Apify actor, probing showed `api.lu.ma` answers unauthenticated JSON for everything needed — the paid actor was never adopted and the biggest-volume source costs $0 nightly. |
| **The docs-of-record habit.** A gotchas.md entry written today repeatedly saves a later session days. | `3458ad6` (bug documented before fixed); the vanity-slug-squatting note (lu.ma/cohere is a coliving community, not Cohere AI) that prevents a recurring data-poisoning mistake. |
| **Measure over eyeball.** | The weserv image fix was chosen on decode-cost reasoning — `6a886a4`'s message quantifies "~15KB vs full-res" and "~10x cheaper decode/paint", not "looks smoother". |

Formal proof recipes (how to *demonstrate* a mechanism end-to-end) are in
**northbound-proof-and-analysis-toolkit**; the open research fronts worth spending
experiment budget on are in **northbound-research-frontier**.

## 6. Running an experiment concretely in this repo

1. **Branch first** (gate G4: gordon-authored commits, commit/push only when asked —
   **northbound-change-control**).
2. **Write the prediction block before running anything** (template below).
3. **Probe scripts**: standalone `.mjs` files inside the repo — Node resolves deps from the
   repo's `node_modules` (a script *outside* the repo cannot `import 'mongoose'`; verified
   2026-07-20). Node v22.22.2 here even imports the repo's `.ts` modules directly via
   type stripping — verified 2026-07-20 with a probe importing `buildFingerprint` from
   `database/fingerprint.ts` — but only through **relative paths**; the `@/*` tsconfig alias
   does not resolve under plain `node`. For alias-using code, run `npx tsx script.ts`
   instead, and wrap top-level `await` in an async IIFE (tsx compiles `.ts` as CJS —
   documented in gotchas.md). Smoke-test HTTP endpoints with Node fetch, **never curl**:
   Tesla/Databricks sit behind TLS-fingerprinting CDNs that 403 all curl (gotchas.md).
4. **Respect the gates while experimenting** (full rules in **northbound-change-control**):
   - G1: no Apify/paid-service run without gordon's approval and a declared `?maxItems=`
     run-option cap + `memoryMb`.
   - G2: the live Atlas cluster IS production. Experiments read via the `--readOnly`
     MongoDB MCP or read-only scripts; any write outside the scrape pipeline needs explicit
     approval, and destructive operations need a backup step first.
5. **Write it up** — in the branch, a gotchas.md draft entry, or the PR description:

```
HYPOTHESIS:        <the mechanism, one sentence, falsifiable>
PREDICTED NUMBERS: <items / ms / $ / doc-count deltas — written BEFORE the run>
PROCEDURE:         <exact commands + scripts, copy-pasteable>
OBSERVATIONS:      <actual numbers, including the ones that surprised you>
MECHANISM:         <does one mechanism now explain ALL observations incl. negatives?>
DECISION:          adopt → ADR-0NN in .claude/docs/decisions.md, code+docs together
                   retire → removal commit + doc update + residue sweep (section 3)
                   inconclusive → gotchas.md note with what would settle it
```

An experiment with no written prediction is a demo, not an experiment.

## When NOT to use this skill

- Triaging a live symptom right now → **northbound-debugging-playbook** (then come back
  here if the cause is contested).
- "Has this been tried before / why is this dead code here" → **northbound-failure-archaeology**.
- Am I allowed to make this change / gate details (G1–G4), ADR mechanics, commit rules →
  **northbound-change-control**.
- Actually running scrapes, the cron, deploys, paid-source protocol → **northbound-run-and-operate**.
- Measurement tooling (source-health, coverage, db-sanity scripts) → **northbound-diagnostics-and-tooling**.
- Step-by-step proof recipes with worked examples → **northbound-proof-and-analysis-toolkit**.
- Which open problems deserve experiments → **northbound-research-frontier**; the coverage
  campaign specifically → **northbound-coverage-campaign**.
- Acceptance thresholds and the test-adding story → **northbound-validation-and-qa**.
- House style for ADRs/gotchas entries → **northbound-docs-and-writing**.

## Provenance and maintenance

Authored 2026-07-20 from repo state at HEAD `63a965a` plus verified git archaeology and
commands run in-session. The discovery-measured numbers marked 2026-07-19 were not
re-measured. Volatile facts and their drift checks:

| Volatile fact (as of 2026-07-20) | One-line re-verification |
|---|---|
| 17 ADRs, next is ADR-018 | `grep -c '^## ADR-' .claude/docs/decisions.md` |
| Scroll-jank chain is `3791db0 ded4973 0b21f84 6a886a4 40b8c19 63a965a` | `git log --oneline 3791db0^..63a965a` (also shows unrelated `66c40f7`) |
| Dead CSS residue (`.reveal`, `.skeleton-overlay`, `cv-card`/`cv-row`) still in globals.css with zero consumers | `grep -n 'reveal\|skeleton-overlay\|cv-' app/globals.css && grep -rn 'reveal\|skeleton-overlay\|cv-card\|cv-row' app components --include='*.tsx'` (expect only the stale SmoothScroll.tsx comment) |
| `ogl` still a dependency with zero imports | `grep '"ogl"' package.json && grep -rn "from 'ogl'" app components lib` |
| gotchas.md still carries the stale weekly-paid-cron claim | `grep -n 'paid sources weekly' .claude/docs/gotchas.md` |
| meetup source still never live-verified (0 docs) | `grep -n -i 'Meetup fetcher' .claude/docs/decisions.md` (and count `{source:'meetup'}` docs via the read-only MongoDB MCP) |
| `/api/refresh` response shape `{ ok, sources, upserted, modified, errors, ranAt }` | `grep -n 'NextResponse.json' -A 8 app/api/refresh/route.ts` |
| `SCRAPE_MAX_ITEMS` default 50 | `grep -n 'SCRAPE_MAX_ITEMS' lib/fetchers/config.ts` |
| Node v22.22.2 runs `.mjs` probes with relative `.ts` imports (type stripping) | `node --version` then run a one-line probe importing `database/fingerprint.ts` |
| MongoDB MCP is read-only | `grep -n 'readOnly' .mcp.json` |
| DB baseline 473 events (company 255, hackathon 139, luma 33, eventbrite 29, mlh 17, meetup 0) — measured 2026-07-19 | `mcp__mongodb__count` on `test.events` (total and per `{source: …}`) |
