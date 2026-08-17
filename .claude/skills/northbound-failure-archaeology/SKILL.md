---
name: northbound-failure-archaeology
description: The Northbound incident chronicle — every major investigation, dead end, rejected approach, and removal (Apify billing overrun, scroll-jank saga, normalizeDate UTC shift, Vercel /_not-found build failure, weekly-cron removal, pre-implementation skill drift), each as symptom → root cause → evidence → status. Load this before re-investigating any bug, perf issue, cost incident, "why is this dead code here", "why is meetup empty", "docs say X but code says Y", or before re-proposing an approach that may already have been tried and rejected.
---

# Northbound Failure Archaeology

This is the settled-battles record for the Northbound repo. Before you investigate a symptom, propose an enhancement, or "fix" something that looks wrong, check here: it may be a **fixed** bug (don't re-fix), a **worked-around** constraint (don't remove the workaround), a **retired** feature (don't resurrect it), or a **wontfix** fence (don't cross it). Verify evidence with read-only git (`git show <hash>`) — never trust a summary over the commit itself.

**Status vocabulary**: `fixed` (root cause eliminated, fix in tree) · `open` (real, unresolved) · `worked-around` (constraint routed around; workaround is load-bearing) · `retired` (feature/approach deliberately removed) · `wontfix` (deliberate fence; needs gordon's sign-off to revisit).

Repo timeline: 26 commits reachable from `main` (20 first-parent), 2026-05-08 → 2026-06-21, all authored by Code_Of_Gordon. Eras: scaffold/models (May) → aggregator core (Jun 9–10) → company events + North America, PR #1 (Jun 13–20) → perf/polish sprint (Jun 20–21). No dead branches; `feature/company-events-north-america` is fully merged (merge `853e598`).

## Quick-lookup index

| # | Area | Symptom / topic | Status |
|---|------|-----------------|--------|
| A1 | frontend | EventCard literal `'/events/${slug}'` href, `organization` prop | fixed |
| A2 | pipeline | Mongoose 9 migration: `FilterQuery`→`QueryFilter`, no `next()`, stray `v8` import | fixed |
| A3 | pipeline | normalizeDate UTC day-shift (evening events on wrong day) | fixed |
| A4 | ops/cost | **Apify billing incident**: meetup actor ignored `maxItems` input, billed ~10× the request (~$1.4–2) | fixed |
| A5 | pipeline | Meetup never live-verified; 0 docs in live DB ever | open |
| A6 | ops/cost | Weekly paid-source cron: added `da2bfb4`, removed `66c40f7`; docs still claim it | retired |
| A7 | pipeline | Recurring series silently lost (bare-title slug E11000) | fixed |
| A8 | pipeline | Foreign-events flood after adding company adapters; re-scrape doesn't delete | fixed |
| A9 | pipeline | Consumer/retail noise (Tesla Father's Day events) | fixed |
| A10 | scraping | Luma vanity-slug squatting (lu.ma/cohere is a coliving community) | worked-around |
| A11 | scraping | GDG/Bevy + CNCF excluded — robots.txt disallows `/api/` | wontfix |
| A12 | scraping | Tesla/Databricks 403 every curl (TLS fingerprinting) | worked-around |
| A13 | scraping | Google devsite random machine-translation broke ids | fixed |
| A14 | scraping | DoraHacks WAF 405 + null-uname 404 URLs | worked-around |
| A15 | scraping | ETHGlobal images die in 1 hour (presigned URLs) | worked-around |
| A16 | scraping | Luma quebec-city discovery page 404 | worked-around |
| A17 | frontend | `$text` + `$or` MongoDB prohibition (hackathon search error) | worked-around |
| A18 | frontend | Home hero flooded by Microsoft Build's 19 city editions | fixed |
| A19 | frontend | DevEvents→Northbound rename; WebGL LightRays removed | retired |
| A20 | ops | GH Actions scrape runs failed red in ~6–9s (secrets unset) | fixed |
| A21 | build | Vercel build failed on `/_not-found` prerender → fail-safe-read doctrine | fixed |
| A22 | pipeline | Luma price `[object Object]`, URL double-prefix, URL-as-venue | fixed |
| A23 | frontend | **Scroll-jank saga** (6 commits) + dead-code residue | fixed |
| A24 | frontend | FilterBar popover forced horizontal page scroll | fixed |
| A25 | pipeline | mongodb.ts hardening + index set — already done, gotchas.md lags | fixed |
| A26 | docs | Pre-implementation skill library (9 skills) systematically drifted | retired |
| A27 | docs | Stale-docs inventory (CONTEXT.md, gotchas.md, posthog-setup-report.md) | open |
| A28 | ops | 8 stale Atlas docs (Montréal / `&#8211;`) — **not reproducible live** | open |

---

## Era 1–2: scaffold and aggregator core (May – June 10, 2026)

### A1. EventCard linked every card to a literal broken URL — fixed
- **Symptom**: every event card navigated to the literal path `/events/${slug}` (single-quoted string, no interpolation); the card also passed a mismatched `organization` prop.
- **Fix**: template-literal href + prop renamed to `organizer`, commit `4749b32`. Current code: `components/EventCard.tsx` (`organizer` destructured from `event`).
- **Status**: fixed.

### A2. Mongoose 9 migration — fixed
- **Symptom**: TypeScript errors writing classic Mongoose middleware after the models milestone.
- **Root cause**: Mongoose 9 removed the `next()` middleware callback (return to continue, throw to abort) and renamed `FilterQuery` to `QueryFilter`. A stray `import { cachedDataVersionTag } from 'v8'` also sat in `database/mongodb.ts`.
- **Fix**: commit `4749b32` migrated middleware, switched to `QueryFilter` (used in `app/api/events/route.ts` and `lib/events.ts`), dropped the v8 import, and added pool/timeout options.
- **Trap**: `.claude/docs/gotchas.md:145` still describes the pre-fix state (see A25/A27). The legacy skills still use `FilterQuery` (see A26) — copying their samples fails typecheck.
- **Status**: fixed.

### A3. normalizeDate UTC day-shift — fixed
- **Symptom**: evening events (an 8 PM Toronto event, `-04:00` offset) stored and displayed under the **next** calendar day.
- **Root cause**: `normalizeDate` did a naive UTC split (`new Date(x).toISOString().split('T')[0]`) — a Toronto evening is next-day in UTC. Date-only strings were additionally pushed through timezone conversion, which shifted *them*.
- **History**: first documented as open debt in commit `3458ad6` (2026-06-09, "Document normalizeDate UTC-shift bug in gotchas"), fixed the next day in `58d715e`, closed in docs in `b4c0497`.
- **Fix in tree**: `database/normalize.ts` — `normalizeDate`/`normalizeTime` extract wall-clock parts in the event's IANA timezone via `Intl.DateTimeFormat` (`partsInZone`); already-normalized `YYYY-MM-DD` strings pass through untouched. The doc comment above `normalizeDate` states the invariant.
- **Trap**: the legacy `data-schema` skill still shows the buggy `getUTCHours()` version.
- **Status**: fixed. Date/time display rules live in northbound-frontend-engineering; normalization rules in northbound-pipeline-engineering.

### A4. THE APIFY BILLING INCIDENT (June 2026) — fixed, with permanent consequences
The project's defining cost incident; hard gate G1 ($0 hosting, run-option caps) exists because of it.

- **Symptom**: a single 12-URL Meetup run via the `easyapi/meetup-events-scraper` actor requested 20 items and collected ~10× that, burning most of the ~$5/month Apify free credit mid-validation. **Two cost figures exist — this entry is the canonical account of both**: `.claude/docs/gotchas.md` contemporaneously logged **~$1.39 / 186+ items**, but the Apify run record itself (GET `/v2/acts/easyapi~meetup-events-scraper/runs/last`, re-checked 2026-07-20) shows **status ABORTED, `usageTotalUsd` ≈ $2.02, dataset itemCount 201**. The run record is authoritative for money; inspection commands live in `northbound-diagnostics-and-tooling`. Other skills citing this incident should say "~$1.4–2, see failure-archaeology A4", not pick one figure.
- **Root cause** (three compounding billing traps):
  1. The actor's `maxItems` **INPUT field is advisory** — this actor ignores it entirely. Apify only enforces billing via the `?maxItems=` **run option** on the run-start request.
  2. Pay-per-event actors charge the start fee **per GB of memory**, and this actor defaults to 4 GB.
  3. A client-side poll timeout alone leaves the actor running (and billing) server-side.
- **Fix**: commit `4d3317d` "Harden Apify client billing: run-option maxItems cap, explicit memory, server-side timeout". Verified in tree as of 2026-07-20: `lib/fetchers/apify.ts` `RunOptions` — always sets `?maxItems=` and `?memory=` as URL params on the run-start POST, plus a server-side `?timeout=` mirroring the poll deadline (`Math.ceil(timeoutMs/1000)+30`) and `waitForFinish=60`; the doc comment records the 10× incident. `lib/fetchers/meetup.ts` passes `maxItems: MAX_ITEMS, memoryMb: 2048, timeoutMs: 280_000`.
- **Consequences (still live)**:
  - **A5**: the meetup source has NEVER completed a live end-to-end run and has **0 documents in the live DB, ever** (re-verified against `test.events` 2026-07-20: `{source:'meetup'}` count = 0). Item shape and plumbing were verified; the full run was blocked when the credit died (`.claude/docs/decisions.md` "Known follow-ups"). Status: **open**. The docs' proposed completion path ("first weekly cron run completes it", `.claude/docs/CONTEXT.md` §4) is dead — that cron was removed (A6).
  - Paid sources were pulled off every schedule (A6).
  - Any Apify run, forever, must set the run-option caps and get gordon's explicit approval first — protocol in northbound-run-and-operate and northbound-change-control.
- **Status**: fixed (client hardened); A5 remains open.

### A6. The weekly paid-source cron: existed, then deliberately removed — retired
- **History**: commit `da2bfb4` (2026-06-10) added `.github/workflows/scrape.yml` with TWO schedules — nightly free sources and `cron: '45 7 * * 0'` (Sunday ~03:45 ET) for paid `eventbrite meetup`. Commit `66c40f7` (2026-06-20, "Free deploy-and-forget scrape") **deleted the weekly entry** to keep hosting $0. As of 2026-07-20 `scrape.yml` has exactly ONE cron (`'15 7 * * *'`, nightly ~03:15 ET, free sources `luma mlh hackathon company`) and its header states Eventbrite + Meetup are "intentionally NOT scheduled" — run manually via local curl.
- **Known-bad ground truth — four docs still claim the weekly cron** (as of 2026-07-20; do not propagate these):
  - `README.md:61` — "Nightly cron (free sources) + weekly (paid Apify sources)"
  - `docs/scheduled-scrape.md:3` ("nightly/weekly scrape") and `:61` ("**Weekly, Sunday ~03:45 ET** — paid Apify sources: `eventbrite meetup`")
  - `.claude/docs/gotchas.md:72` — "the cron runs paid sources weekly, free sources nightly"
  - `.claude/docs/CONTEXT.md:136` ("paid Apify sources weekly") and `:166` ("First weekly cron run … completes it")
  - The workflow file is the truth. Fix list is owned by northbound-docs-and-writing.
- **Do not re-add any schedule for eventbrite/meetup** — that is a G1 violation requiring gordon's explicit approval.
- **Status**: retired (the weekly cron); the doc claims are open items in A27.

---

## Era 3: company events + North America (June 13–20, PR #1)

### A7. Recurring series silently lost every occurrence after the first — fixed
- **Symptom**: Microsoft Reactor sessions and Figma webinars appeared once, then never again; upsert logs looked like benign E11000 dedup races.
- **Root cause**: scraper slugs were derived from the bare title; series reuse titles across dates, so occurrence #2+ collided on the unique slug index and was silently dropped inside the E11000-tolerant bulkWrite.
- **Fix**: slug now embeds the date — ``$setOnInsert: { fingerprint, slug: generateSlug(`${doc.title} ${doc.date}`) }`` in `lib/scrape.ts` (comment above documents the failure). Live slugs end in the date (e.g. `...-pinecone-2026-08-20`).
- **Known residual hole (open, candidate)**: `lib/scrape.ts` treats ANY bulk E11000 as benign, but two *different* events with the same title+date in *different cities* have identical slugs yet different fingerprints — the loser is still silently swallowed. `gotchas.md:231` prescribes `err.keyPattern` discrimination; never implemented. If you see cross-city same-title losses, this is why. Owned by northbound-pipeline-engineering.
- **Status**: fixed (series case); slug/fingerprint asymmetry open.

### A8. Foreign-events flood; re-scrape doesn't delete — fixed, lesson permanent
- **Symptom**: after bespoke company adapters landed, the feed filled with Bengaluru/London/Sydney/Seoul events; 58/122 company events had country "TBA".
- **Fix**: ADR-015 (`.claude/docs/decisions.md`) — `lib/fetchers/geo.ts` `classifyRegion`, persisted `region` field, `lib/scrape.ts` drops `region === 'INTL'` pre-upsert (company events 122→74).
- **Hard-won lesson**: tightening a gate does NOT clean the DB — upserts only touch matching fingerprints; gated items are skipped, never deleted. Cleanup required a throwaway `tsx` script doing `deleteMany` (MongoDB MCP is `--readOnly` and cannot; `gotchas.md:59-64`). Any future gate-tightening needs the same follow-up, and any DB write needs G2 approval — see northbound-run-and-operate.
- **Status**: fixed.

### A9. Consumer/retail noise (Tesla) — fixed
- **Symptom**: company lane barren and Tesla-dominated — 13 "Father's Day"/test-drive/store events drowned real dev content.
- **Fix**: ADR-017 — `isConsumerEvent()` drops retail noise from ALL company feeds; `DEV_ONLY_COMPANIES` brands (Tesla) additionally require `isRelevant(title+description)` — deliberately NOT tags, because every doc carries a baseline `'tech'` tag that would match everything (`lib/scrape.ts`). Tesla → 0 events but stays in the directory as tracked.
- **Status**: fixed.

### A10. Luma vanity-slug squatting — worked-around
- **Symptom**: nearly ingested a coliving community's calendar as "Cohere AI"; `lu.ma/modal` is unrelated to Modal Labs.
- **Rule**: slugs prove nothing. Always resolve via `api.lu.ma/url?url=<slug>`, verify the calendar display name, and pin `calendarApiId` in `lib/fetchers/config.ts` (Cohere = `cal-400NOkbFqzrkJNA`). Details in northbound-source-platforms-reference.
- **Status**: worked-around (permanent convention).

### A11. GDG/Bevy + CNCF: a fenced path — wontfix
- **What happened**: GDG (`gdg.community.dev`, Bevy platform) and CNCF community events have working unauthenticated APIs, but robots.txt disallows `/api/` for all agents. Skipping them is an etiquette call made in ADR-010, reaffirmed in ADR-013 ("**Still skipped**: GDG/Bevy + CNCF community…", `.claude/docs/decisions.md:168`). Snowflake's cleaner `_jcr_content` filter.json API is avoided for the same reason (adapter parses `__INITIAL_STATE__` from the page instead).
- **Do not** add a Bevy/CNCF fetcher or switch Snowflake to the disallowed API without gordon's sign-off — this is a deliberate fence, not an oversight.
- **Status**: wontfix.

### A12–A16. Platform-hostility cluster — worked-around (details: northbound-source-platforms-reference)
| # | Incident | Resolution in tree |
|---|----------|--------------------|
| A12 | Tesla + Databricks 403 every curl (Akamai/Cloudflare TLS fingerprinting) while the app worked | Smoke-test with `npx tsx` (Node fetch + `BROWSER_UA`), **never curl** (`gotchas.md:44`) |
| A13 | Google devsite randomly machine-translated pages (th/pt-BR/ko observed), translating the h3 slugs used as ids → duplicated/lost events | `lib/fetchers/companies/google.ts` pins `?hl=en` + `accept-language: en-US` — **fixed** |
| A14 | DoraHacks returned 405 + HTML AWS-WAF challenge on bursts; one null-`uname` item made a `/null/` 404 URL | `lib/fetchers/dorahacks.ts`: skip null unames, non-JSON content-type → throw (never parse), `sleep(1100)` ≈ 1 req/s |
| A15 | ETHGlobal banner images died within an hour (1-hour presigned S3 URLs) | `lib/fetchers/ethglobal.ts` deliberately stores `image: ''`; card falls back |
| A16 | Luma `quebec-city` discovery feed 404s (no such page as of 2026-06) | `lib/fetchers/config.ts` omits it; Eventbrite/Meetup slugs cover QC |

### A17. `$text` + `$or` prohibition — worked-around
- **Symptom**: searching inside the hackathon lane threw a MongoDB query error.
- **Root cause**: MongoDB forbids `$text` alongside top-level `$or`; the hackathon lane's includeOngoing logic uses `$or [{date>=from},{endDate>=from}]`.
- **Fix**: `lib/events.ts` — `includeOngoing` is forced off whenever `q` is present (`const includeOngoing = !q && …`); with a `to` bound the `$or` nests under `$and`. Do not "simplify" this guard away.
- **Status**: worked-around (fixed in `0c493c9`).

### A18. Microsoft Build flooded the hero — fixed
- 19 near-identical city editions of "Build //localhost" filled a plain date-sorted company rail. Fix: `diverseCompanyEvents()` in `lib/events.ts` — `$sort`/`$group $first`-per-organizer aggregation (Microsoft example in the docstring).
- **Status**: fixed.

### A19. DevEvents → Northbound; LightRays removed — retired
- Commit `0c493c9` (2026-06-20): rebrand (name clash with dev.events; DevRadar was runner-up), full UI redesign, hackathon sources, freshness layer. Same commit **deleted `components/LightRays.tsx` (452 lines, ogl WebGL animated backdrop)** and added the static CSS `components/Backdrop.tsx` — both for the calmer aesthetic and because the animation was heavy (see A23).
- **Residue**: `ogl ^1.0.11` still sits in `package.json` dependencies with zero imports anywhere (verified 2026-07-20). Do not "use it since it's installed"; it is dead weight awaiting removal.
- **Still open from the rename**: GitHub repo rename + production domain + `package.json` name (`events_site`) are pending gordon.
- **Status**: retired (LightRays); rename completion open.

### A20. GH Actions scrape runs failed red every night — fixed
- **Symptom**: every scheduled "Scrape events" run died red in ~6–9 s.
- **Root cause**: `SITE_URL`/`CRON_SECRET` repo secrets were unset; curl hit an empty URL.
- **Fix**: `0c493c9` added a config-check step — scheduled runs skip-with-warning when secrets are missing; manual `workflow_dispatch` hard-fails (`scrape.yml` "Check configuration").
- **Epilogue — the cron IS live**: the ScrapeMeta singleton (`test.meta`, `{key:'scrape'}`) shows a full free-source loop (luma → mlh → hackathon → company, seconds apart, matching scrape.yml's loop order) with most recent `lastRunAt` 2026-07-19T09:15Z and `lastErrors: []` (checked live 2026-07-20). Any note claiming "scrape cron still needs deploy+secrets" is stale.
- **Status**: fixed.

---

## Era 4: the perf/polish sprint (June 20–21)

### A21. Vercel build failed on `/_not-found` → the fail-safe-read doctrine — fixed
- **Symptom**: production build aborted prerendering `/_not-found` with "MongoDB URI does not exist".
- **Root cause**: the global Footer renders the freshness badge on every page — including the statically-prerendered `/_not-found` at build time, where `MONGODB_URI` may be absent or Atlas unreachable; `connectDB()` threw and killed the prerender.
- **Fix**: commit `2b8c7b9` — `getScrapeStatus()` in `lib/meta.ts` wraps its entire read in try/catch and degrades to "no badge" (`EMPTY`); the comment above it states the doctrine.
- **Doctrine**: any data read reachable from the root layout (Navbar/Footer/global chrome) must never throw — it runs at build time on pages with no env. Apply this to every future global-chrome data read.
- **Status**: fixed.

### A22. Luma price `[object Object]`, URL double-prefix, URL-as-venue — fixed
- **Symptoms**: (a) cards showed price as `[object Object]`; (b) some Luma webinars displayed a registration URL as their physical location with a bogus city; (c) outbound Register links 404'd as `https://lu.ma/https://example.com` for externally-hosted events (YC, Google, CerebralValley calendars).
- **Root causes**: (a) Luma's `ticket_info.price` is `{cents, currency}`, mapper did `String(price)`; (b) organizers mislabel webinars `location_type:'offline'` and paste a URL in the address field; (c) mapper unconditionally prefixed `https://lu.ma/` onto `raw.url`, which is sometimes already absolute.
- **Fixes** (a,b in `ded4973`; c in `0c493c9`), all verified in `database/normalize.ts` as of 2026-07-20: `lumaPrice()` handles object/number/string; `venueIsUrl` regex forces online mode; url is prefixed only when not already `^https?://`. **Existing DB rows were repaired** per the `ded4973` commit body — do not assume old rows still carry the bugs.
- **Status**: fixed.

### A23. THE SCROLL-JANK SAGA — fixed, residue in tree
Six commits in ~36 hours where three "progressive enhancements" each partly caused the jank they were meant to polish. The definitive perf archaeology of this repo.

**What was added, and why (the losers)**:
| Commit | Enhancement | Intent |
|--------|-------------|--------|
| (pre-saga) | `ogl` WebGL LightRays backdrop | animated hero atmosphere — removed in `0c493c9` (A19) |
| `3791db0` | `cv-card`/`cv-row` (`content-visibility: auto`) | skip offscreen render work |
| `ded4973` | `.reveal` scroll-reveal (`animation-timeline: view()`) + image fade over placeholder | scroll polish, smoother image pop-in |
| `0b21f84` | Lenis smooth scrolling + `.skeleton-overlay` shimmer | eased momentum scroll, loading affordance |

**How they interacted badly (the diagnosis)**:
- Full-resolution scraped images were the **dominant cost** — decode/paint of arbitrary-CDN originals during fast scroll.
- `content-visibility: auto` render/unrender churn **fought Lenis's rAF loop** — Lenis animates native scroll every frame, so items constantly crossed the render boundary.
- Each image `onLoad` flipped **React state**, so a screenful of loads cascaded re-renders mid-scroll.
- `backdrop-filter` blur on the sticky header **re-blurred everything scrolling beneath it every frame**; the fixed backdrop's `filter: blur(120px)` recomposited expensively.

**The fixes (the winners)**:
| Commit | Fix |
|--------|-----|
| `6a886a4` | Resize every scraped image through `images.weserv.nl` → width-capped WebP (`&w=…&output=webp&q=72`; `w=640` default, `240` rows, `1280` detail); **remove** all `cv-card`/`cv-row` and `.reveal` usage |
| `40b8c19` | Image fade made **DOM-only**: mutate `element.style.opacity` in `onLoad`/ref, React state only on error; shimmer skeleton usage dropped |
| `63a965a` | `.glass` header made **solid** (`bg-[#0a0b0d]/90`, no backdrop-filter); Backdrop reduced to static radial-gradient + masked grid, explicit "no filter blur" comment |

**Settled end state** (do not regress; conventions owned by northbound-frontend-engineering / DESIGN.md): weserv-proxied width-capped WebP in `components/EventImage.tsx` with proxy→original→failed fallback; DOM-only opacity fade; solid `.glass` sticky header; static CSS `components/Backdrop.tsx`; Lenis retained (`components/SmoothScroll.tsx`, disabled under reduced-motion).

**Residue still in the tree** (verified present 2026-07-20 — dead code, safe to delete with G3/G4 discipline, do NOT treat as active features):
- `app/globals.css`: `@utility cv-card` / `cv-row` (~line 90), the `.reveal` block + `@keyframes reveal-up` (~lines 128–150), `.skeleton-overlay` + its `::after` shimmer (~lines 179–196) — **zero consumers** in any `.tsx`.
- `components/SmoothScroll.tsx:9`: comment claims "the scroll-driven reveal animations keep working" — those were removed one commit later in `6a886a4`. Stale.
- `package.json`: `"ogl": "^1.0.11"` — unused since `0c493c9` (A19).
- **Status**: fixed (perf); residue cleanup open (candidate).

### A24. FilterBar popover forced a page-wide horizontal scrollbar — fixed
- Left-anchored popover under a right-aligned button overflowed the viewport. Fix in `3791db0`: `sm:left-auto sm:right-0`, width `min(90vw, 28rem)` (`components/FilterBar.tsx`).
- **Status**: fixed.

### A25. mongodb.ts hardening and the index rebuild — already done; gotchas.md lags
Two "recommendations" a reader of `.claude/docs/gotchas.md` might re-implement. **Both are done**:
- `database/mongodb.ts` already has `maxPoolSize: 10, serverSelectionTimeoutMS: 10000` (lines 41–42, verified 2026-07-20), and the stray `v8` import is long gone (`4749b32`) — despite `gotchas.md:145` describing both as pending.
- The old `{date:1, mode:1}` compound index that `gotchas.md:269` calls "backwards" **no longer exists**; `database/event.model.ts` has the recommended set: fingerprint unique+sparse, `{mode,date}`, `{city,date}`, `{tags,date}`, `{region,date}`, `{date,_id}`, unweighted text index. Live DB indexes matched the model exactly (measured 2026-07-19). Related: a Mongoose duplicate-index warning was fixed by declaring the slug index only via `unique: true` on the field (comment in `event.model.ts`).
- **Never adopted** (recommendation drift, not bugs): gotchas.md's weighted text index (`event_text`, weights 10/5/1) and `autoIndex: false` + `syncIndexes()` on deploy (`gotchas.md:270,319`). Treat as candidates, not as missing regressions.
- **Status**: fixed (hardening/indexes); gotchas.md corrections open (A27).

---

## Era 5: knowledge drift (ongoing)

### A26. The pre-implementation skill library — retired 2026-07-20
The 9 project skills under `.claude/skills/` (`event-scraping`, `apify-actors`, `data-schema`, `deduplication`, `database`, `backend-api`, `frontend`, `calendar-button`, `scheduling`) were authored in commit `519805e` (2026-06-09) **before the implementation existed**; their only later edit was an 8-line rename in `0c493c9`. They describe plans, and the plans drifted. They are **replaced by this library (2026-07-20)** — never cite them as authority. Representative, verified drift:
- **SWR**: prescribed by the pre-retirement `skills/README.md` (stack table) and `frontend/SKILL.md` — both files have since been replaced/truncated in the live tree, so read the originals via `git show 519805e:.claude/skills/frontend/SKILL.md` (or `git show 0c493c9:...` for the last pre-retirement state); `swr` was never installed and appears nowhere in code (URL-state + server components won).
- **Luma via Apify** (`mhamas/luma-calendar-events-scraper` in `apify-actors`/`event-scraping`): superseded by ADR-009 — free direct `api.lu.ma` JSON API (`lib/fetchers/luma.ts`), completely different raw shape.
- **`FilterQuery`** in `database`/`frontend`/`backend-api` skill samples: removed in Mongoose 9; code uses `QueryFilter` (A2).
- **`vercel.json` Vercel Cron** (`scheduling` skill Option A): never existed — no `vercel.json` in the repo, and Vercel Cron only issues GET while `/api/refresh` is POST (`gotchas.md:307`); GitHub Actions is the scheduler. The skill's entire `revalidateTag`/cache-invalidation section is likewise unimplemented (zero `revalidate*` calls; routes are `force-dynamic`).
- Also stale: "propose the schema diff" (already applied, plus a 6th `hackathon` source-enum value and a `region` field no skill mentions), "GTA-only scope" (product is North-America scoped), buildFingerprint location, calendar-button component name/event/options.
- **Status**: retired. Mine them only with per-claim verification.

### A27. The stale-docs inventory — open (fix list owned by northbound-docs-and-writing)
Known-bad spots verified as of 2026-07-20 — read around them, never propagate:
| Doc | Stale claim |
|-----|-------------|
| `.claude/docs/CONTEXT.md` §3 (~line 151) | "FETCHERS registry is empty … refresh is a no-op" — all 6 sources are registered and live (`lib/scrape.ts`) |
| `.claude/docs/CONTEXT.md` §9 repo map (~lines 259–267) | `app/api` "NOT YET" (3 route groups exist), lists deleted `components/LightRays.tsx`, calls `constants.ts` a placeholder-events file |
| `.claude/docs/CONTEXT.md` §3/§6 | source enum listed as 5 values (misses `hackathon`); omits the `region` field/index |
| `.claude/docs/gotchas.md:145` | v8 import + missing pool options — both resolved (A2, A25) |
| `.claude/docs/gotchas.md:269-270,319` | "backwards" index + autoIndex advice — index set already rebuilt (A25) |
| `.claude/docs/gotchas.md:72`, `CONTEXT.md:136,166`, `README.md:61`, `docs/scheduled-scrape.md:3,61` | weekly paid cron (A6) |
| `posthog-setup-report.md` | pre-rebrand ("DevEvent"); claims `event_card_clicked` sends a `company` prop — code sends `organizer` (`components/EventCard.tsx:39`); claims `NEXT_PUBLIC_POSTHOG_HOST` is wired — no code reads it |
| `AGENTS.md` / `CLAUDE.md` | referenced by CONTEXT.md/ADR-002/REFERENCES.md as repo-root files; **they do not exist** — any instruction to "read AGENTS.md" dead-ends |
- **Status**: open.

### A28. The "8 stale Atlas docs" — claimed open, NOT reproducible live
- **The claim** (`.claude/docs/decisions.md:284`, `CONTEXT.md:167-168`): 8 pre-normalization docs remain in Atlas (city `Montréal`, one `&#8211;` in a title), created before city canonicalization/entity decoding; upserts match on fingerprint so fixed re-scrapes created NEW canonical docs instead of correcting them.
- **Live check 2026-07-20** (read-only MCP against `test.events`, 473 docs total — unchanged from the 2026-07-19 audit): `{city:'Montréal'}` → **0**; `{title:/&#8211;/}` → **0**; every `^Montr` city is canonical `Montreal` (19 docs). The claimed docs are gone — most plausibly swept by the row-repair passes in `ded4973`/`0c493c9`, though no commit explicitly records it.
- **Action**: treat the decisions.md follow-up as stale; do NOT write a cleanup script for docs that no longer exist (a G2 write for nothing). Re-run the counts (commands below) before believing either state.
- **Status**: open only as a docs correction; the data problem appears resolved.

---

## When NOT to use this skill

- **Diagnosing a live symptom now** → northbound-debugging-playbook (symptom→triage with discriminating experiments; this file only tells you whether the battle was already fought).
- **Changing scrapers/normalization/schema/dedup** → northbound-pipeline-engineering. **UI/API-surface work** → northbound-frontend-engineering.
- **How each platform behaves (Tesla faux-UTC dates, Luma API shapes, robots reality)** → northbound-source-platforms-reference.
- **Running scrapes, the cron, deploys, prod-DB etiquette, the paid-source protocol** → northbound-run-and-operate; measurement scripts → northbound-diagnostics-and-tooling.
- **The rules the incidents produced (the four hard gates, ADR discipline)** → northbound-change-control; standing invariants → northbound-architecture-contract.
- **Fixing the stale docs enumerated here** → northbound-docs-and-writing (owns templates/house style; this file owns the archaeology of *why* they're stale).
- **Reviving Eventbrite/Meetup coverage or the local lane** → northbound-coverage-campaign (the decision-gated plan); evidence standards for declaring something verified → northbound-validation-and-qa.

## Provenance and maintenance

Authored 2026-07-20 from repo state at HEAD `63a965a` + live read-only Atlas checks. Every commit hash was confirmed via `git log`/`git show`; every file claim re-read in tree; DB counts measured via the read-only MongoDB MCP. Numbers labeled 2026-07-19 were measured that day and not re-measured unless noted — re-derive them with the table below rather than citing the measurement session.

This file is append-mostly: when an investigation concludes, add an entry (symptom → root cause → evidence → status) and update the index; when a status changes (e.g. residue deleted, docs fixed, meetup finally verified), flip the status here in the same change.

| Volatile fact (as of 2026-07-20) | One-line re-verification |
|---|---|
| meetup has 0 docs ever (A5) | MongoDB MCP: `count` db `test` coll `events` query `{"source":"meetup"}` → expect 0 |
| Nightly cron is the ONLY schedule (A6) | `grep -n "cron:" .github/workflows/scrape.yml` → exactly one line, `'15 7 * * *'` |
| Weekly-cron claims still in 4 docs (A6/A27) | `grep -rn -i weekly README.md docs/scheduled-scrape.md .claude/docs/gotchas.md .claude/docs/CONTEXT.md` |
| Dead CSS blocks still present (A23) | `grep -n 'cv-card\|reveal\|skeleton-overlay' app/globals.css` |
| Dead CSS still has zero consumers (A23) | `grep -rn 'reveal\|skeleton-overlay\|cv-card\|cv-row' app components --include='*.tsx'` → only the SmoothScroll comment |
| `ogl` still an unused dependency (A19/A23) | `grep -n '"ogl"' package.json; grep -rn "from 'ogl'" app components lib` → dep present, zero imports |
| SmoothScroll stale comment (A23) | `sed -n '8,10p' components/SmoothScroll.tsx` |
| gotchas.md v8/index/autoIndex paragraphs still stale (A25/A27) | `grep -n 'cachedDataVersionTag\|date: 1, mode: 1\|autoIndex' .claude/docs/gotchas.md` |
| mongodb.ts hardening in place (A25) | `grep -n 'maxPoolSize\|serverSelectionTimeoutMS' database/mongodb.ts` |
| Apify run-option caps in place (A4) | `grep -n "params.set('maxItems'" lib/fetchers/apify.ts` |
| Stale Montréal/`&#8211;` docs still absent (A28) | MongoDB MCP: `count` db `test` coll `events` query `{"city":"Montréal"}` → expect 0 |
| Cron still running green (A20) | MongoDB MCP: `find` db `test` coll `meta` filter `{"key":"scrape"}` → `lastRunAt` within ~24h, `lastErrors: []` |
| Legacy 9 skills still on disk (A26) | `ls .claude/skills/` |
| `AGENTS.md`/`CLAUDE.md` still absent (A27) | `ls AGENTS.md CLAUDE.md` → both "No such file" |
| Total event count (473 on 2026-07-20) | MongoDB MCP: `count` db `test` coll `events` query `{}` |
