---
name: northbound-research-frontier
description: The four open research fronts where Northbound (the event-aggregator repo) can advance past its current state — entity resolution beyond exact-hash dedup (signal-to-noise), coverage at $0, ICS/webcal subscription feeds (product surface), and an agent-operable codebase. Load for "what should we work on next", "improve dedup / near-duplicate matching", "add a calendar feed / ICS / webcal", "make this repo safer for agents/tests", or any open-ended Northbound roadmap or research question.
---

# Northbound research frontier — the four open fronts

**STATUS: NOTHING in this skill is adopted policy.** Every step below is *open* or
*candidate* work. The owner (gordon) selected these four fronts on 2026-07-19 as the
directions worth advancing; none has an ADR, and shipping any of them requires the normal
gates. This skill exists so a future session can pick up a front without re-deriving the
problem, the evidence, or the first moves.

Before executing anything that writes to the repo, the database, dependencies, CI, or the
UI, load `northbound-change-control`. The four hard gates, compressed:

| Gate | One line |
|---|---|
| G1 $0 hosting | Nothing that costs money without explicit approval first; Apify runs always set the `?maxItems=` RUN option |
| G2 prod DB sacred | The live Atlas cluster IS production; no writes outside the scrape pipeline without approval; experiments stay read-only |
| G3 UI law | PRODUCT.md / DESIGN.md govern anything user-visible |
| G4 authorship | Branch-first; commits gordon-authored; commit/push only when asked |

Method for all fronts — predictions-first, evidence bar, adversarial refutation — lives in
`northbound-research-methodology`. Proof recipes live in `northbound-proof-and-analysis-toolkit`.

---

## Front 1 — Signal-to-noise: entity resolution beyond the exact hash

### Why the current approach falls short

Dedup today is a single exact hash: `buildFingerprint` in `database/fingerprint.ts` =
`sha256(lower(trim(title)) + '|' + date + '|' + lower(trim(city)))` (time deliberately
excluded), upserted on a unique-sparse `fingerprint` index by `runScrape` in
`lib/scrape.ts`. Exact match means any drift in title or city string mints a brand-new
document. Verified failure classes, with examples from the prod DB (read-only audit run,
2026-07-20; rows marked structural/historical do not have a live same-event pair today):

| Miss class | Live example (fingerprint prefixes) |
|---|---|
| Title drift on re-scrape — same URL, same date, edited title | `672fefa9`/`e25b0684`/`daf154dc`: "AIE Networking Leaders Dinner" / "AIE Leaders Networking Dinner" / "AIE Leaders Dinner" — THREE docs, one URL, one date |
| Accent/spelling variants in the *title* (city canonicalization in `database/normalize.ts` `CITY_ALIASES` fixes only the city field) | `f51c9cbc`/`c229d101`: "Fintech Social Montreal" vs "Fintech Social Montréal", same lu.ma URL, same date |
| City naming variants defeat both hash and blocking (**structural** — no confirmed same-event cross-city pair yet) | Metro-variant city strings are live in the corpus: the same Google I/O series carries city=`Madanayakanahalli` (`1a43e49c` "I/O Bengaluru", 2026-07-14; `02641875` "I/O Connect Bengaluru", same city+date) AND city=`Bengaluru` (`07b0806a` "Google I/O Connect Bengaluru Hackathon", 2026-07-11). Note the cross-city docs also differ in date, so no pair here demonstrates blocking actually missing a duplicate — the class is a structural risk |
| Multi-city editions / recurring series flood the UX even when each doc is individually correct | `diverseCompanyEvents()` in `lib/events.ts` (one-soonest-event-per-organizer aggregation) exists solely because Microsoft's "Build //localhost" ran 19 near-identical city editions — a UX-layer patch over an entity-resolution gap |
| Fingerprint-keyed upserts can't *correct* old bad docs (**historical** — the cited docs are gone) | Demonstrated by the since-vanished 8 pre-normalization docs (city "Montréal", one `&#8211;` title): fixed re-scrapes created NEW canonical docs instead of updating them. Live check 2026-07-20 found 0 matching docs — CONTEXT.md §4's "Stale docs in Atlas" follow-up is stale (see `northbound-failure-archaeology` A28) — but the mechanism remains real |

### Measured sizing (as of 2026-07-20)

`scripts/near-dup-audit.mjs` in this skill's directory is the shipped, read-only sizing
instrument (step i below — already built and run). Output against the live DB, 473 docs:

- Blocking on `(date, lower(city))`: **84 blocks** hold >1 doc (276 docs). Within blocks,
  trigram-Jaccard title similarity finds **1 pair ≥0.90, 5 pairs 0.70–0.89, 8 pairs
  0.50–0.69** — and **0 of these 14 pairs are cross-source**.
- Same `url` under multiple fingerprints: **22 groups**, of which **13 are single-date**
  (dupe-suspect: one event, drifted identity) and **9 span dates** (series-suspect: NOT dupes).

Honest read of the numbers: the *observed* problem today is **within-source title drift on
re-scrape** (same URL, same date), not cross-source matching — cross-source overlap between
e.g. Luma and Eventbrite listings has not yet materialized in the corpus. Roughly ~20
candidate pairs out of 473 docs (~4% of docs implicated). That is real but small; the
front's value rests on the corpus growing nightly and on future sources increasing overlap.
Treat every audit line as a **candidate**, never a confirmed duplicate, until hand-labeled.

### Northbound's specific asset

A multi-source corpus (473 docs as of 2026-07-20, growing via the free nightly cron) where
every doc carries `url`, `organizer`, `source`, and optional `sourceId`
(`database/event.model.ts`) — real matching features, plus genuine drift pairs occurring in
production that can serve as labeled ground truth. Few side projects have an organically
generated entity-resolution dataset; this one does.

### First three concrete steps

1. **Size the problem (DONE — re-run to track drift).** From the repo root:
   `node --env-file=.env.local .claude/skills/northbound-research-frontier/scripts/near-dup-audit.mjs`
   (add `--pairs` for a TSV of every candidate pair). Read-only; exits 0.
2. **Hand-label the candidates into a golden-pairs fixture** (candidate format — not yet
   adopted): a JSON array of `{a: <fingerprint>, b: <fingerprint>, label}` with labels
   `duplicate | series-occurrence | multi-city-edition | distinct`. Label with both source
   pages open (each doc's `url`) — titles alone mislead (e.g. `07b0806a` "Google I/O Connect
   Bengaluru Hackathon" vs `00cace6f` "Google DeepMind Bengaluru Hackathon" share a URL and
   date but may be genuinely distinct tracks). Where the fixture lives is an open question —
   natural home is the test-fixture area proposed by `northbound-validation-and-qa`.
3. **Prototype a second-pass matcher as a STANDALONE experiment script** — never wired into
   the pipeline without change control. Feature priority the 2026-07-20 measurements
   suggest: (a) same `url` + same `date` (trivially high precision — covers 13 groups
   today), (b) same `url` + near dates (must NOT fire on series), (c) blocked
   title-similarity as shipped in the audit script, (d) `organizer` + `date` + similar title
   across a city/metro alias table (catches the Bengaluru class that city-blocking misses).
   Score it against the labeled fixture; report precision/recall.

### You have a result when…

…the prototype's **precision/recall on the labeled set, reported with numbers**, beats the
exact-hash baseline. (By construction the exact hash scores recall 0 on labeled duplicates —
anything it could catch is already one doc — so the bar is: high precision at meaningful
recall, with every false positive inspected.) **Falsifiable kill-criterion:** if hand-labeling
shows true duplicates are under ~2% of upcoming docs and the rate is not growing
week-over-week, write the numbers down and park the front — the UX patches already in place
(`diverseCompanyEvents`, lane filters) may be sufficient at this corpus size.

### Traps

- G2: an experiment script never merges or deletes in prod. A matcher *proposes*; the exact
  fingerprint stays the write-path invariant (`northbound-architecture-contract`).
- A `series-occurrence` is not a duplicate — collapsing one deletes a real event. This repo
  already paid for that lesson once: bare-title slugs silently dropped every recurrence
  after the first (see the `$setOnInsert` slug comment in `lib/scrape.ts`).
- Do not "fix" dedup by loosening the in-pipeline fingerprint (e.g. dropping city) — that
  collapses legitimate multi-city editions in the wrong direction.

---

## Front 2 — Coverage at $0

**Execution lives in `northbound-coverage-campaign` — that skill owns the phases, the
metric, the baseline, and the decision gates. Do not duplicate it; load it.** This section
only states the frontier claim.

**The claim to prove:** a credible multi-city tech-event aggregator can run on zero
infrastructure spend (Vercel Hobby + Atlas M0 + GitHub Actions + free direct APIs).

**Verified shortfall (as of 2026-07-20 counts, re-measured):** the local lane is the thin
one — lifetime docs by source: company 255, hackathon 139, **luma 33, eventbrite 29,
meetup 0** (meetup has never written a document). The paid Apify sources (eventbrite,
meetup) are intentionally unscheduled per the header comments in
`.github/workflows/scrape.yml` — the free path must carry local coverage.

**Asset:** six registered sources of which four are free and already on the nightly cron
(live: the ScrapeMeta singleton showed `lastRunAt` 2026-07-19T09:15Z with per-source stamps
for luma/mlh/hackathon/company when checked 2026-07-20). The metric instrument is
`coverage-report.mjs` (`northbound-diagnostics-and-tooling`).

**You have a result when…** — two nested bars, not competing ones. *Campaign success* is
defined by `northbound-coverage-campaign` (metric sustained above its threshold across ≥2
consecutive cycles — that skill owns the gate). This front's stronger *research claim* is
proven only when the campaign's coverage metric holds **above its Phase 0 baseline for 4
consecutive weeks with $0 spent** (Apify spend included — an approved one-off paid run
resets the streak only if the campaign defines it that way; see the campaign skill).

---

## Front 3 — Product surface: ICS subscription feeds first

### Why the current approach falls short

The product is a one-way browse surface (3 pages). The only calendar path is per-event:
`components/AddToCalendar.tsx` (add-to-calendar-button-react, options
Google/Outlook.com/Microsoft365/Apple/iCal). There is **no subscription** — a user must
keep returning to the site to learn about new events, which is exactly what PRODUCT.md's
principle 5 ("**Frictionless exit.** Success is the user leaving — to register at the
source or to their calendar") says the product should not require. Meanwhile the bookings
surface is dead weight: `POST /api/bookings` and `database/booking.model.ts` have **zero UI
consumers** (verified 2026-07-20: no `bookings` reference in any component/page;
`components/RegisterButton.tsx` is an outbound `<a>` to `event.url`), and README's API list
omits the route.

### Northbound's specific asset

A normalized store that is unusually feed-ready:

- **Stable slugs**: slug is written once at insert (`$setOnInsert` in `lib/scrape.ts`) and
  never rewritten on re-scrape — a natural, stable ICS `UID` (e.g. `<slug>@northbound`).
- `queryEvents` (`lib/events.ts`) already expresses the lane/city/region/category filter
  contract, so per-lane and per-city feeds fall out of existing query params.
- Every event carries `date` (YYYY-MM-DD), `time` (HH:MM), IANA `timezone`, optional
  `endDate`/`endTime` — sufficient for correct VEVENT serialization.
- The nightly cron keeps content fresh without any new infra.

### First three concrete steps

1. **Build a feed route handler** (candidate path: `app/feed.ics/route.ts` or
   `app/api/feed/route.ts` — check segment-naming rules against the bundled Next 16 docs at
   `node_modules/next/dist/docs/01-app`, the source of truth per
   `northbound-architecture-contract`) that serializes `queryEvents()` output as
   `text/calendar` VCALENDAR. `lib/events.ts` is `server-only`, which imports fine in a
   route handler. **Decision needed first: hand-rolled serializer vs a library** (`ics` or
   `ical-generator`) — a new dependency needs approval (`northbound-change-control`).
   Hand-rolled checklist (RFC 5545): CRLF line endings; 75-octet line folding; TEXT
   escaping (`\` `;` `,` newlines); stable `UID`; `DTSTAMP`; and the timezone decision —
   emitting `DTSTART;TZID=America/Toronto:...` strictly requires a matching `VTIMEZONE`
   component, whereas converting each event's wall-clock + IANA tz to UTC (`Z` form) avoids
   `VTIMEZONE` entirely and is the simpler correct option. Respect the string-dates
   invariant: never `new Date(\`${date}T${time}\`)` without applying the event's own
   timezone. Note `queryEvents` clamps `limit` to 60 — a feed wants the whole upcoming
   window, so either paginate internally or gate a clamp change through change control.
2. **Validate in a real calendar client** before surfacing anything: run `npm run dev`,
   download the feed, import it into Google Calendar ("Import") and/or Thunderbird, and
   check events land on the correct local day and time across timezones (online events,
   Toronto events, US events).
3. **Surface `webcal://` links per lane/city** — e.g.
   `webcal://<host>/feed.ics?source=company`, `?category=hackathon`, `?city=Toronto` —
   mirroring the `/events` URL filter contract. This is UI work: G3 applies, route through
   `northbound-frontend-engineering`.

### You have a result when…

…an **external Google Calendar subscription ("From URL") renders the local lane correctly
across a week of nightly cron updates** — new events appear, dates/times are right, no
duplicates from UID churn. Caveat (external behavior, not controllable): Google polls
subscribed feeds on its own slow cadence (commonly many hours to a day+); the one-week
window exists precisely to absorb that.

### Open questions

- Removing the orphaned bookings surface (`app/api/bookings/`, `database/booking.model.ts`)
  is a separate, owner-signed-off change — do not bundle it into feed work.
- A public feed endpoint has no auth or rate limiting (no GET route does today); fine at
  current scale, but Vercel free-tier bandwidth is part of G1's $0 envelope — note it in
  the proposal.

---

## Front 4 — Agent-operable codebase

### Why the current approach falls short (verified 2026-07-19/20)

- **Zero tests**: `package.json` scripts are dev/build/start/lint only; a repo-wide find
  for `*.test.*` / `*.spec.*` / vitest / jest configs returns nothing (re-run 2026-07-20).
- **The lint gate is red by known baseline**: `npm run lint` exits 1 — one real error
  (react-hooks/purity: `Date.now()` during render, `components/FreshnessBadge.tsx`) plus
  warnings mostly from `.claude/` scripts that `eslint.config.mjs` does not ignore. Do not
  treat exit 1 as your failure; current counts, causes, and the fresh-clone caveat live in
  `northbound-build-and-env`. Lint cannot serve as a pass/fail gate until both are fixed.
- **No CI beyond the scrape cron**: `.github/workflows/` contains only `scrape.yml`; Next
  16's `next build` no longer runs ESLint. The de-facto validation gate is
  `npx tsc --noEmit` (passes clean).
- **Tribal knowledge with known drift**: `.claude/docs/CONTEXT.md` §3/§9 are stale and four
  docs still describe a weekly paid-source cron that does not exist — the fix list lives in
  `northbound-docs-and-writing`. Gates today are manual conventions, not enforced checks.

### Northbound's specific asset

- This 16-skill library itself, replacing the systematically stale 9 pre-implementation
  legacy skills.
- A pipeline built from deterministic pure functions that are ideal characterization-test
  subjects: `normalizeRawEvent` (`database/normalize.ts`), `buildFingerprint`
  (`database/fingerprint.ts`), `generateSlug` (`database/event.model.ts`),
  `classifyRegion`/`cleanTitle` (`lib/fetchers/geo.ts`), `laneOf` (`lib/constants.ts`).
- One working machine gate already exists: `db-sanity.mjs`
  (`northbound-diagnostics-and-tooling`) **already exits non-zero on invariant violation**
  — it just isn't mandatory anywhere. `source-health.mjs` / `coverage-report.mjs` are
  informational instruments (exit 0).

### First three concrete steps

1. **Land the characterization-test candidate from `northbound-validation-and-qa`**: frozen
   raw-input→canonical-output fixtures over the pure functions above, so refactors can't
   silently change normalization. The test runner is a new dev dependency (vitest is the
   natural fit for this TS/ESM repo) → approval first per `northbound-change-control`.
2. **Make the gates mandatory-by-declaration** (candidate policy): any session touching the
   pipeline or schema runs `db-sanity.mjs` (exit-code gate) plus `source-health.mjs`
   before AND after, and includes both outputs before declaring success. Hardening
   candidate: a CI workflow running `npx tsc --noEmit` + the characterization tests on
   pushes/PRs; lint joins the gate only after the FreshnessBadge error is fixed and
   `.claude/` is added to eslint ignores.
3. **Run the benchmark**: hand a fresh Sonnet-class session a scripted task — "add one
   company to the registry" (runbook: `northbound-pipeline-engineering`) — with only the
   skill library as context, and **count human interventions**. Log every intervention as a
   missing or wrong fact, and file it into the skill that owns that territory.

### You have a result when…

…a fresh Sonnet-class session completes the scripted adapter task end-to-end with **zero
human fixes, twice in a row**. Falsifiable regression signal: if interventions recur on a
fact after it was filed into a skill, the library's *format* (not just its content) is
failing — escalate to `northbound-docs-and-writing`.

---

## Choosing a front

| Front | Prerequisites | Can start today? |
|---|---|---|
| 1 Signal-to-noise | Read-only DB access; `.env.local` | Yes — audit script shipped and run |
| 2 Coverage at $0 | `northbound-coverage-campaign` Phase 0 | Yes — via that skill |
| 3 ICS feeds | Serializer decision (dep approval if library); deploy context for the live test | Route + local validation: yes. Live milestone: needs the deployment |
| 4 Agent-operable | Test-runner dep approval (step 1); nothing for steps 2–3 | Steps 2–3: yes |

Fronts are independent; don't serialize them artificially. Every front ends in a numbers
report, not a vibe — see `northbound-research-methodology` for the evidence bar.

## When NOT to use this skill

- Executing the coverage campaign (phases, metric, decision gates) → `northbound-coverage-campaign`.
- Whether you're *allowed* to make a change; ADR discipline → `northbound-change-control`.
- Something is broken right now → `northbound-debugging-playbook`; past investigations and dead ends → `northbound-failure-archaeology`.
- How the system works / invariants you must not break → `northbound-architecture-contract`.
- Actually changing scrapers/schema/dedup config → `northbound-pipeline-engineering`; UI/API-surface work → `northbound-frontend-engineering`.
- Running scrapes, the cron, deploys → `northbound-run-and-operate`; env setup → `northbound-build-and-env`.
- Measuring current state with the shipped instruments → `northbound-diagnostics-and-tooling`.
- The evidence bar, test-adding candidate, acceptance thresholds → `northbound-validation-and-qa`; experiment discipline → `northbound-research-methodology`; proof recipes → `northbound-proof-and-analysis-toolkit`.
- Platform internals (how api.lu.ma, MLH, Devpost etc. expose data) → `northbound-source-platforms-reference`; docs/house style → `northbound-docs-and-writing`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit 63a965a (uncommitted work present) plus
commands run against the live Atlas DB (read-only). All DB numbers were measured via
read-only aggregations or `scripts/near-dup-audit.mjs` on 2026-07-20 unless stamped
otherwise. The four-front selection and the "nothing here is policy" framing were confirmed
by the owner on 2026-07-19.

Volatile facts and how to detect drift (run from the repo root):

| Volatile fact (as stated above) | One-line re-verification |
|---|---|
| 473 docs; per-source counts (meetup 0) | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs` |
| Near-dup sizing (84 blocks / 14 sim-pairs / 22 URL groups, 13 single-date) | `node --env-file=.env.local .claude/skills/northbound-research-frontier/scripts/near-dup-audit.mjs` |
| Fingerprint recipe = sha256(title\|date\|city) | `sed -n '1,13p' database/fingerprint.ts` |
| One-per-organizer home aggregation + Build-19-editions rationale | `grep -n 'diverseCompanyEvents\|19 near-identical' lib/events.ts` |
| No feed route yet (api = bookings, events, refresh) | `ls app/api app 2>/dev/null \| grep -i 'feed\|ics' \|\| echo 'no feed route'` |
| Bookings still orphaned (no UI consumer) | `grep -rn bookings components/ app/page.tsx app/events/ --include='*.tsx' \|\| echo orphaned` |
| Still zero tests | `find . -path ./node_modules -prune -o \( -name '*.test.*' -o -name 'vitest.config.*' \) -print` |
| Lint still red (FreshnessBadge Date.now) | `npm run lint >/dev/null 2>&1; echo "lint exit: $?"` |
| Paid sources still unscheduled; single nightly cron | `grep -n 'cron:' .github/workflows/scrape.yml` |
| Calendar options (no subscription, per-event only) | `grep -n 'options=' components/AddToCalendar.tsx` |
| queryEvents limit clamp still 60 | `grep -n 'Math.min(Math.max(params.limit' lib/events.ts` |
| Nightly cron live (ScrapeMeta lastRunAt fresh) | `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs` (see meta section) |
