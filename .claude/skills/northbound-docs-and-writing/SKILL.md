---
name: northbound-docs-and-writing
description: Maintaining Northbound's docs of record — CONTEXT.md, decisions.md (ADRs), gotchas.md, REFERENCES.md, README.md, PRODUCT.md/DESIGN.md, docs/scheduled-scrape.md, and the .claude/skills library. Load when updating or writing any doc, logging an ADR or gotcha, fixing stale documentation ("docs say X but code says Y"), checking public claims (README, OG/Twitter metadata, JSON-LD, sitemap), or writing/editing a SKILL.md for agents.
---

# Northbound docs and writing

Northbound is an event-aggregator (Next.js 16 App Router + MongoDB/Mongoose 9, six scrape
sources, GitHub Actions nightly cron, Vercel). This skill is the runbook for its written
record: which doc is authoritative for what, the entry templates, the known-stale spots and
how to fix them, and the discipline for anything the public can read.

**Prime rule: code and workflows outrank every doc.** This repo's docs have drifted before
(see the fix list below). When a doc contradicts the repo, the repo wins; then fix the doc.
Never propagate a doc claim into new writing without re-checking it against the code.

## 1. The doc hierarchy — authority order

Terms: **ADR** = Architectural Decision Record, one appended entry per accepted decision.
**Docs of record** = the files below; everything else (chat, memory, scratchpads) is not durable.

| Rank | File | Role | Update when | Status as of 2026-07-20 |
|---|---|---|---|---|
| 0 | The code + `.github/workflows/scrape.yml` | Ground truth | — | Always wins on conflict |
| 1 | `PRODUCT.md`, `DESIGN.md` (repo root) | Product/design LAW for all UI work (gate G3 — see `northbound-change-control`) | Only with owner sign-off | **UNTRACKED** — must be committed to be durable; `PRODUCT.md` has a stub `## Register` section whose body is the single word "product" (scaffolding residue) |
| 2 | `.claude/docs/decisions.md` | 17 ADRs (ADR-001..017, all Accepted, 2026-06-08..13) + "Known follow-ups / tech debt" tail | Append a new ADR for any architectural choice; never rewrite old entries | Healthy; one stale follow-up ("First weekly cron run … completes it" — that cron no longer exists) |
| 3 | `.claude/docs/gotchas.md` | Trap catalog — read before touching scraping/dedup/DB/routes | Append when you hit a non-obvious trap | Mostly excellent; 4 stale paragraphs (fix list §3) |
| 4 | `.claude/docs/CONTEXT.md` | Project snapshot ("read this first") | On milestone completion | **PARTLY STALE** — snapshot frozen ~2026-06-13; §3 and §9 are wrong (fix list §3) |
| 5 | `.claude/docs/REFERENCES.md` | Verified external links, package versions, MCP config | When a dependency/link/version changes | Good; references ghost files `AGENTS.md`/`CLAUDE.md` |
| 6 | `.claude/skills/*/SKILL.md` + `.claude/skills/README.md` (index) | Agent runbooks; the index must list exactly the current skills | When code invalidates a skill claim: update the skill AND its Provenance table | Index rewritten 2026-07-20 — lists the current 16-skill `northbound-*` library; keep it true when skills are added/removed |
| 7 | `README.md` | Public face of the repo | Through change control only (public claims — §5) | Two stale claims (fix list §3) |
| 8 | `docs/scheduled-scrape.md` | Cron runbook | When `scrape.yml` changes | Stale weekly-cron section (fix list §3) |
| 9 | `posthog-setup-report.md` | Pre-rebrand wizard artifact ("DevEvent") | **Never** — historical record | Known-wrong: claims `event_card_clicked` sends `company` (code sends `organizer`, `components/EventCard.tsx` capture call) and that `NEXT_PUBLIC_POSTHOG_HOST` is consumed (`instrumentation-client.ts` hardcodes `api_host: "/ingest"`). Do not "fix" it; do not cite it |

Also note: the 9 legacy skills (`event-scraping`, `apify-actors`, `data-schema`,
`deduplication`, `database`, `backend-api`, `frontend`, `calendar-button`, `scheduling`)
were written BEFORE the implementation and are systematically stale (SWR never installed,
Luma-via-Apify superseded by ADR-009's free `api.lu.ma`, Mongoose `FilterQuery` removed in
v9 in favor of `QueryFilter`, a vercel.json cron that never existed). Never cite them as
authority. The `northbound-*` skills replace them.

**Ghost files:** `AGENTS.md` and `CLAUDE.md` do not exist at the repo root (verified
2026-07-20), yet CONTEXT.md §8/§9, ADR-002, and REFERENCES.md ("Project knowledge docs"
section) all reference them as present. Whether they were deliberately superseded or lost
is an **open question for gordon** — flag, don't fabricate replacements.

## 2. Templates

### ADR entry (`.claude/docs/decisions.md`)

Exact house format, taken from the file itself. Append AFTER the last ADR and BEFORE the
`## Known follow-ups / tech debt` section, newest at the bottom. Append-only: never edit a
past ADR's Decision; supersede it with a new ADR (ADR-009 superseding ADR-004's Luma actor
is the in-repo example).

```markdown
## ADR-0NN — <Short imperative title>
**Status**: Accepted · YYYY-MM-DD

**Context**: <What forced a decision — the observed problem, with numbers if you have them.>

**Decision**: <The choice, key nouns **bolded**. One paragraph or a short bullet list.>

**Rationale**:
- <Why this beats the alternatives — concrete, verifiable reasons.>

**Consequences**: <What is now true / what got harder. Name alternatives rejected and why.>
```

In the follow-ups tail, completed items are struck through with `~~…~~` plus a note
(e.g. `~~database/mongodb.ts stray v8 import~~ — already removed`), not deleted.

### Gotcha entry (`.claude/docs/gotchas.md`)

House form: topic `##` sections (Scraping, MongoDB, …) with `###` subsections per
platform/tool, then terse bullets. Each bullet packs symptom → cause → correct behavior
into one or two sentences, with the evidence inline (an ADR number, a file, or a cost:
"one runaway meetup run ate ~$1.40"). Match that density — no headings per gotcha, no
prose paragraphs. Example of the register:

```markdown
- Beware misleading vanity slugs: `lu.ma/cohere` is a coliving community, NOT Cohere AI
  (their calendar is `cal-400NOkbFqzrkJNA`). Verify a calendar belongs to the company
  before adding it to the registry.
```

### Skill Provenance section (this library's convention)

Every `northbound-*` SKILL.md ends with `## Provenance and maintenance`: an "authored
<date> from repo state + verified commands" line, then a table of volatile facts, each
with a ONE-LINE re-verification command. When a code change invalidates a skill claim,
update the claim AND its Provenance row in the same change. See §6 for the full convention.

## 3. The stale-docs fix list

Actionable table, verified against the repo 2026-07-20. **Routing:** rows marked
*routine* may be fixed by a future session directly (docs-only change, branch-first per
gate G4). Rows marked *public* touch README.md → route through `northbound-change-control`
first. Rows marked *flag* need an owner decision — do NOT pick a side and "fix" them.

| # | Doc / location | Wrong claim | Correct fact | Evidence | Route |
|---|---|---|---|---|---|
| 1 | `README.md` repo-map row for `scrape.yml` (line 61) | "Nightly cron (free sources) + weekly (paid Apify sources)" | One nightly cron `'15 7 * * *'` runs free sources only (luma, mlh, hackathon, company); eventbrite/meetup are manual-only | Commit `66c40f7` ("Free deploy-and-forget scrape") removed the weekly cron; `.github/workflows/scrape.yml` has exactly one `cron:` line | public |
| 2 | `docs/scheduled-scrape.md` — intro ("nightly/weekly") and the schedule list ("Weekly, Sunday ~03:45 ET — paid Apify sources") | Same weekly-paid-cron claim | Same nightly-free-only reality | Same as #1; the doc was last touched in commit `0c493c9`, before `66c40f7` | routine |
| 3 | `.claude/docs/gotchas.md` Apify-budget bullet ("the cron runs paid sources weekly, free sources nightly") | Same weekly claim | Same nightly-free-only reality | Same as #1 | routine |
| 4 | `.claude/docs/CONTEXT.md` §3 (scheduled-scrape para + "First weekly cron run … completes it" in §4) | Paid sources scheduled weekly; Meetup live-verification completes via the weekly cron | No paid schedule exists; Meetup verification needs a new completion path (manual run — see `northbound-run-and-operate`) | Same as #1 | routine |
| 5 | `.claude/docs/CONTEXT.md` §3 ("`FETCHERS` registry is **empty until the scraper milestone** — refresh is a no-op") | Registry empty, refresh a no-op | `lib/scrape.ts` `FETCHERS` registers all six sources (luma, eventbrite, meetup, mlh, company, hackathon); the pipeline is live. §3 even self-contradicts ("built and live-tested 2026-06-10") | `lib/scrape.ts` FETCHERS map | routine |
| 6 | `.claude/docs/CONTEXT.md` §3/§6 field list ("EXACT — do not invent different names") | `source` enum has 5 values; no `region` field | Enum has 6 values incl. `'hackathon'`; `region` (`CA\|US\|ONLINE\|INTL\|UNKNOWN`) + `{region:1,date:1}` index exist | `database/event.model.ts` source enum + region field; ADR-015 | routine |
| 7 | `.claude/docs/CONTEXT.md` §9 repo map | `app/api/` "NOT YET"; lists `components/LightRays.tsx (+ .css)`; `lib/constants.ts` = "placeholder events array (temporary)" | Three API route groups exist (`app/api/{events,bookings,refresh}`); LightRays was replaced by `components/Backdrop.tsx`; `constants.ts` now holds `CITIES`/`laneOf()`/`COUNTRY_FLAG` | `ls app/api`; `components/Backdrop.tsx`; `lib/constants.ts` | routine |
| 8 | `.claude/docs/gotchas.md` mongodb.ts note ("stray `import { cachedDataVersionTag } from 'v8'`… add `maxPoolSize`, `serverSelectionTimeoutMS`") | Import present, options missing | Import removed (decisions.md follow-ups already struck it); `maxPoolSize: 10` and `serverSelectionTimeoutMS: 10000` are present in `connectDB` options | `database/mongodb.ts` (grep `v8` → nothing) | routine |
| 9 | `.claude/docs/gotchas.md` text-index recipe (weights `title:10/tags:5/description:1`, name `event_text`) | Reads as if applied | Shipped index is unweighted, no custom name — the weighted version is an unadopted recommendation; label it as such | `database/event.model.ts` text index | routine |
| 10 | `.claude/docs/gotchas.md` autoIndex advice (`autoIndex: false` in prod + `Event.syncIndexes()` on deploy, stated twice) | Reads as if applied | Not implemented — EventSchema has no `autoIndex` option; Mongoose default auto-index applies. Label as open recommendation | `database/event.model.ts` schema options | routine |
| 11 | `README.md` API row (line 59) | Public API = `GET /api/events`, `GET /api/events/[slug]`, `POST /api/refresh` | `POST /api/bookings` also exists (`app/api/bookings/route.ts`) — but it has zero UI consumers, so whether to document it or delete the route is part of the flag | `ls app/api` | public + flag |
| 12 | `scrape.yml` comments ("well inside Vercel Hobby's ~60 s function cap", twice) vs `docs/scheduled-scrape.md` ("the route's 300 s ceiling") vs `app/api/refresh/route.ts` `maxDuration = 300` | Two contradictory production ceilings | Unresolved — depends on the Vercel plan/config, which the repo cannot determine. Needs an owner decision, then align all three | All three files | **flag** |
| 13 | `.claude/docs/CONTEXT.md` purpose line + §7; ADR-006 | Calendar export includes **Yahoo** | Shipped options are `['Google', 'Outlook.com', 'Microsoft365', 'Apple', 'iCal']` — no Yahoo. Intentional scope cut or oversight? | `components/AddToCalendar.tsx` options prop | **flag** |
| 14 | CONTEXT.md §8/§9, ADR-002, REFERENCES.md "Project knowledge docs" | `AGENTS.md` + `CLAUDE.md` exist at repo root | Neither file exists | `ls *.md` at repo root | **flag** |
| 15 | ~~`.claude/skills/README.md` (index) — "canonical list of 9" legacy skills; stack table said SWR, `ogl` LightRays, Yahoo, 5-value source enum, 2 PostHog events~~ | Done 2026-07-20 | Index rewritten as the 16-skill `northbound-*` library index; keep it matching the skills on disk | `ls .claude/skills/` | ~~routine~~ done |
| 16 | `PRODUCT.md` `## Register` | Section body is the single word "product" | Scaffolding residue — but PRODUCT.md is law under G3, so even deleting a stub needs owner sign-off | `head PRODUCT.md` | **flag** |

When applying routine fixes: prefer surgical edits that preserve each doc's voice; in
gotchas.md convert stale prescriptions into "(recommendation — not adopted)" labels rather
than deleting the knowledge; in decisions.md never rewrite an ADR — strike through the
stale follow-up bullet with a dated note, exactly like the existing `~~v8 import~~` row.

## 4. House style

- **Voice**: "Calm, technical, confident" — PRODUCT.md's brand-voice section, and it
  applies to docs too. Precise and unembellished; state what a thing is and why it matters;
  no hype, no filler, no emoji.
- **Date-stamp volatile facts** inline: "as of 2026-07-20". Counts, versions, live-site
  claims, and anything measured decays; a dated claim tells the next reader how much to
  trust it.
- **Verified vs proposed** — never blur them. Unproven or unadopted things stay labeled
  "open", "candidate", or "recommendation — not adopted" (fix-list rows 9-10 exist because
  this rule was broken).
- **Append, don't rewrite**, in decisions.md (§2) and gotchas.md. Snapshot docs
  (CONTEXT.md) may be rewritten wholesale — that is their failure mode too, so re-verify
  every carried-forward claim when you do.
- **One home per fact.** Deep coverage lives in exactly one doc/skill; everyone else
  cross-references it by name. Duplicated facts drift independently — the weekly-cron claim
  rotted in four places at once precisely because it had four homes.
- **Runbook imperative voice in skills**: "Run X. If Y, then Z." Tables and checklists over
  prose. Copy-pasteable commands, each verified by actually running it before you write it.
- **Cite repo files by path + identifier** (function/const/section name). Use line numbers
  sparingly — they drift with every edit; identifiers survive.

## 5. Public-claims discipline

Anything an outsider can read — README.md, HTML metadata, OG/Twitter cards, JSON-LD —
must match the code at publish time. Changing these routes through
`northbound-change-control` (README is the repo's public face; the site metadata ships to
production). The as-verified public surface, 2026-07-20:

| Surface | Where | State (verified) |
|---|---|---|
| Canonical URL | `app/layout.tsx` `SITE_URL` const → `metadataBase` | Reads `NEXT_PUBLIC_SITE_URL` with silent fallback `https://northbound.vercel.app`. **Trap:** the var is documented in neither `.env.example` nor `.env.local`, and the linked Vercel project is `northbound-dev` — deployed canonical/OG URLs may point at the wrong host until this is set. Rename/domain decision is pending gordon |
| Meta description | `app/layout.tsx` `metadata.description` | "…Google, AWS, Microsoft, NVIDIA, YC, Databricks and **20+ more companies**…" — safe undercount |
| OG description | `app/layout.tsx` `metadata.openGraph.description` | "official dev events from **38+ companies**" — hardcoded. Matches the live registry TODAY (`COMPANY_SOURCES` in `lib/fetchers/config.ts` has exactly 38 entries as of 2026-07-20) but WILL drift as companies are added. Re-verify both numbers whenever the registry changes (command in §7) |
| "updated nightly" | OG + Twitter descriptions | **TRUE** — the nightly cron is live and green end-to-end: repo secrets `SITE_URL`/`CRON_SECRET` were set 2026-06-21, and scheduled runs complete with per-source meta stamps (verified 2026-07-20 via `gh run list` + the meta doc). Older notes calling this "aspirational / secrets pending" are stale. Re-verify with `gh run list --workflow=scrape.yml` before republishing; details in `northbound-run-and-operate` |
| OG/Twitter images | `app/opengraph-image.png`, `app/twitter-image.png` (static files) | Present |
| JSON-LD | `app/events/[slug]/page.tsx` — `application/ld+json` script | Present: schema.org Event with attendance-mode mapping (ADR-014). Implementation details: `northbound-frontend-engineering` |
| PWA manifest | `app/manifest.ts` | Present |
| Sitemap / robots | `app/sitemap.ts`, `app/robots.ts` | **Neither exists** (verified 2026-07-20). If asked "does Northbound have a sitemap?", the truthful answer is no — adding one is an open candidate, not a fix |

**The live-verified bar:** never publicly claim a source/feature that has not passed the
evidence bar in `northbound-validation-and-qa`. Standing example: the Meetup fetcher has
never completed a live end-to-end run (Apify credit exhausted mid-validation, 2026-06) —
README may describe Meetup as a supported manual source, but any claim implying Meetup
events are flowing would be an oversell. Unproven stays labeled.

**Claim-count hygiene:** any hardcoded number in public copy (company counts, event
counts, city lists) needs either (a) a live-derived value in code, or (b) a Provenance-style
re-verification note near it. When you touch `COMPANY_SOURCES`, re-check the "38+" and
"20+" strings in `app/layout.tsx` in the same change.

## 6. Writing for agents (skills)

The audience for `.claude/skills/northbound-*` is a future Sonnet-class session with zero
project context. What works:

- **Trigger-rich descriptions.** The frontmatter `description` is the ONLY thing the model
  sees when deciding to load the skill. Pack it with concrete tasks ("add company X",
  "update the README"), symptoms ("docs say X but code says Y", "401 from /api/refresh"),
  and literal keywords (file names, error strings, command names). Mention Northbound.
  Never marketing language — a description that says "comprehensive guide to best
  practices" triggers on nothing.
- **Lead with deltas from standard practice.** The reader already knows Next.js and
  MongoDB; tell them what THIS repo does differently (string dates, bulkWrite skips
  pre-save hooks, `QueryFilter` not `FilterQuery`) and skip the textbook.
- **Define every project-specific term once at first use** (ADR, lane, fingerprint,
  freshness badge…). Imperative runbook voice; tables over prose; every command verified
  by running it.
- **One home per fact** across the library — cover your territory deeply, reference
  siblings by exact skill name for theirs.
- **End with `## Provenance and maintenance`**: authored-date + method line, then a table
  of the skill's volatile facts, each with a one-line re-verification command. This is the
  library's drift alarm: a future session runs the commands, and any mismatch means the
  skill needs updating before it is trusted. When your code change invalidates a skill
  claim, update the claim and its Provenance row in the same branch — that is what keeps
  this library from becoming the next legacy-skills incident (9 skills written from a plan,
  never reconciled with the implementation, now unciteable).
- **Keep the index true.** `.claude/skills/README.md` must list exactly the current skills.
  Adding or removing a skill without updating the index recreates fix-list row 15.

## When NOT to use this skill

- **Deciding whether a change is allowed, gating, ADR discipline (when to write one),
  commit/branch rules** → `northbound-change-control`. This skill owns the ADR *format*;
  change-control owns the *process*.
- **Fixing the code a doc disagrees with** (pipeline/schema/dedup) →
  `northbound-pipeline-engineering`; UI/metadata/JSON-LD implementation →
  `northbound-frontend-engineering`.
- **The history behind a doc-drift incident** (weekly-cron removal, legacy-skill rot,
  billing overrun) → `northbound-failure-archaeology`.
- **Running scrapes, the cron, deploy, prod-DB etiquette** → `northbound-run-and-operate`.
- **The evidence bar itself and live-verification procedure** →
  `northbound-validation-and-qa`.
- **Architecture facts to cite in a doc** → `northbound-architecture-contract`.
- **Environment/env-var facts to cite** → `northbound-build-and-env`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` + commands run against the working
tree. Discovery leads dated 2026-07-19 were independently re-verified before inclusion,
except where a fact is stamped 2026-07-19.

| Volatile fact | Re-verify with |
|---|---|
| 17 ADRs, all Accepted | `grep -c '^## ADR-' .claude/docs/decisions.md` |
| `COMPANY_SOURCES` has 38 entries (backs the "38+" OG claim) | `sed -n '/^export const COMPANY_SOURCES/,/^];/p' lib/fetchers/config.ts \| grep -c 'company:'` |
| OG/meta hardcoded counts ("38+", "20+ more") | `grep -n '38+\|20+ more' app/layout.tsx` |
| Exactly one cron (nightly, free sources) | `grep -n 'cron:' .github/workflows/scrape.yml` |
| Weekly-cron claim still present in README/gotchas/scheduled-scrape/CONTEXT | `grep -rn 'weekly' README.md docs/scheduled-scrape.md .claude/docs/gotchas.md .claude/docs/CONTEXT.md` |
| README API list omits `POST /api/bookings`; route still exists | `grep -n 'api/' README.md \| head -5; ls app/api` |
| No sitemap.ts / robots.ts | `ls app/sitemap.ts app/robots.ts` |
| `NEXT_PUBLIC_SITE_URL` fallback + absence from .env.example | `grep -n 'NEXT_PUBLIC_SITE_URL' app/layout.tsx .env.example` |
| PRODUCT.md / DESIGN.md still untracked | `git status --porcelain -- PRODUCT.md DESIGN.md` |
| `AGENTS.md`/`CLAUDE.md` still absent at root | `ls AGENTS.md CLAUDE.md` |
| JSON-LD still emitted on detail pages | `grep -n 'application/ld+json' 'app/events/[slug]/page.tsx'` |
| gotchas.md stale paragraphs (v8 import, weights, autoIndex) still uncorrected | `grep -n 'v8\|weights\|autoIndex' .claude/docs/gotchas.md` |
| CONTEXT.md §3 FETCHERS-empty claim still present | `grep -n 'no-op' .claude/docs/CONTEXT.md` |
| Calendar options still exclude Yahoo | `grep -n 'options=' components/AddToCalendar.tsx` |
| Skills index (rewritten 2026-07-20) lists exactly the skills on disk | `ls .claude/skills/` — compare against the index's skill list |
| GitHub secrets `SITE_URL`/`CRON_SECRET` present (set 2026-06-21); nightly cron green → "updated nightly" true | `gh secret list; gh run list --workflow=scrape.yml --limit 3` |

If any command's output contradicts this skill, the repo wins: update the affected section
and this table in the same change.
