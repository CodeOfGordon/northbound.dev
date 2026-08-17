---
name: northbound-debugging-playbook
description: Symptom→triage playbook for Northbound (this event-aggregator repo). Load FIRST when anything misbehaves — scrape wrote 0/few items, E11000 duplicate key, events dated one day off, price shows "[object Object]", register links 404 as https://lu.ma/https://..., company fetchers 403 under curl, Google events in the wrong language, Vercel build fails on /_not-found, scroll jank, npm run lint exits 1, Mongo collections look empty, freshness badge stale, GET /api/events?source=hackathon ignored, mixed-case /events/SLUG 404s. Each symptom has a first check, a discriminating experiment, and a fix-or-escalate route.
---

# Northbound debugging playbook

Triage runbook for this repo's REAL failure modes — every entry below has occurred here or is a
verified live hole. Find your symptom in the master table, jump to its section, run the first
check, then the discriminating experiment. Fix routes point to sibling skills; this skill is for
*diagnosis*, not deep fixes.

Hard rules that bound every experiment (details: `northbound-change-control`):
- **Never run the paid sources** (`eventbrite`, `meetup`) as a debugging step — they cost Apify credit. Free sources: `luma`, `mlh`, `hackathon`, `company`.
- **The live Atlas cluster IS production.** All DB checks below are read-only. No writes outside the scrape pipeline without explicit approval.

## 30-second orientation

Pipeline: `POST /api/refresh` (Bearer `CRON_SECRET` auth, `app/api/refresh/route.ts`) → `runScrape` in `lib/scrape.ts` → per-source fetcher (`lib/fetchers/*`) → `normalizeRawEvent` (`database/normalize.ts`) → gates (region/consumer/relevance) → `buildFingerprint` (`database/fingerprint.ts`) → `Event.bulkWrite` upsert. Six sources: `luma`, `eventbrite`, `meetup`, `mlh`, `company`, `hackathon` (registry: `FETCHERS` in `lib/scrape.ts`).

Terms used below:
- **fingerprint** — dedup key `sha256(lower(title)|date|lower(city))`, unique+sparse index. The upsert filter.
- **slug** — URL id, set only on insert: `generateSlug(title + ' ' + date)` — note: **no city** (this matters, see S2).
- **region gate** — `classifyRegion` (`lib/fetchers/geo.ts`) marks non-North-America events `INTL`; `lib/scrape.ts` drops them pre-upsert.
- **meta doc** — singleton `{key:'scrape'}` in collection `meta`, written by the refresh route; powers the "Updated X ago" badge.
- **Prod data lives in Mongo db `test`**, not `events_site` (see S12).

Reproduce locally: `npm run dev`, then (free source only):

```bash
curl -s -X POST http://localhost:3000/api/refresh \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"sources":["luma"]}'
```

Response shape: `{ok, sources, upserted, modified, errors, ranAt}`. **Watch the dev-server console too** — per-city/per-company/per-provider failures are `console.warn` only and do NOT appear in the `errors` array (verified: `fetchCompany` and `fetchHackathons` catch-and-warn per entry, `fetchLuma` per city slug).

## Master symptom table

| Symptom | First check | Top suspects | § |
|---|---|---|---|
| Scrape wrote 0 or few items | `errors` array + dev-server warns | dead endpoint · INTL gate · relevance/consumer gates · `SCRAPE_MAX_ITEMS` · `MAX_HACKATHON_DAYS` · already-stored (healthy) | S1 |
| E11000 duplicate key during scrape | which index: `fingerprint_1` or `slug_1`? | benign cross-source race vs. slug-collision silent drop (open hole) | S2 |
| Event dated one day off / wrong time | stored `date`/`time`/`timezone` vs. source page | UTC-shift class in a mapper; faux-UTC source dates | S3 |
| Price shows `[object Object]` or garbage | which source; the mapper's price line | object-shaped price field mapped with `String()` | S4 |
| Register link is `https://lu.ma/https://...` | stored `url` field | unconditional `lu.ma/` prefixing; pre-fix stored row | S5 |
| Company fetcher "broken" — 403s | were you testing with curl? | TLS-fingerprinting CDN blocks curl; Node fetch passes | S6 |
| Google events duplicated/lost, foreign-language titles | `?hl=en` still pinned in `google.ts`? | devsite random machine-translation | S7 |
| Vercel build fails on `/_not-found` | which global component reads the DB at build? | non-fail-safe DB read in layout/Footer scope | S8 |
| Scroll jank is back | what was recently added to sticky/fixed/image/CSS? | reintroduced backdrop-filter, content-visibility, React-state fades, full-res images | S9 |
| `npm run lint` exits 1 | is it the known baseline? | pre-existing `FreshnessBadge` purity error + skill-script warnings | S10 |
| `GET /api/events?source=hackathon` returns everything | route `SOURCES` whitelist | API/page layer divergence (known) | S11 |
| Connected to Mongo, collections empty | which **database** are you in? | data is in db `test`, not `events_site` | S12 |
| Freshness badge stale or missing | the meta doc, then cron run history | secrets-unset silent skip · meta fallback · fail-safe EMPTY | S13 |
| `/events/SLUG` 404s but API resolves it | slug case | page path doesn't lowercase; API route does | S14 |

## S1. Scrape wrote 0 or few items

First: read the refresh response `errors` + the dev-server console (see orientation — the two report different layers). Then discriminate in this order:

1. **Already stored (healthy).** `upserted: 0` with a nonzero `modified` — or even `modified: 0` — is normal when nothing changed: the upsert matches on fingerprint and unchanged docs count as neither upserted nor modified. Compare against DB counts per source (read-only, db `test`): `mcp__mongodb__count {database:'test', collection:'events', query:{source:'luma'}}`.
2. **Endpoint dead / shape changed.** Console warns like `luma: city "toronto" skipped — ...` or `company: Figma (figma) skipped — ...`. Smoke-test the fetcher directly (free endpoints only) — note the `.default` unwrap, required because `tsx -e` evaluates as CJS:
   ```bash
   npx -y tsx -e "import('./lib/fetchers/luma').then(async ({default: m}) => console.log((await m.fetchLuma()).length))"
   ```
   NEVER smoke-test with curl (S6). For endpoint/raw-shape details per platform: `northbound-source-platforms-reference`.
3. **Region INTL gate.** Fetcher returns items but few survive: `lib/scrape.ts` drops `doc.region === 'INTL'` pre-upsert. Foreign-city feeds (company adapters pull GLOBAL feeds) lose most items *by design*. Check a suspicious city (verified 2026-07-20 — bare "London" is UK/INTL, "London, ON" is CA):
   ```bash
   npx -y tsx -e "import('./lib/fetchers/geo').then(({default: g}) => console.log(g.classifyRegion({city:'London', country:'TBA', venue:'', online:false})))"
   ```
4. **Consumer-noise / relevance gates.** `source === 'company'` only, at scrape time (`lib/scrape.ts`): `isConsumerEvent(title+description)` drops retail noise from ALL company feeds; brands in `DEV_ONLY_COMPANIES` (currently only Tesla, via `devOnly: true` in `lib/fetchers/config.ts`) additionally require `isRelevant(title+description)`. Tesla at 0 events is the *designed* outcome. Separately, the broad feeds (luma city / eventbrite / meetup) apply `isRelevant` inside their fetchers. Test a title against the regexes in `lib/fetchers/relevance.ts` with the same tsx pattern.
5. **`SCRAPE_MAX_ITEMS` cap.** `MAX_ITEMS = max(1, parseInt(SCRAPE_MAX_ITEMS ?? '50'))` (`lib/fetchers/config.ts`) caps EVERY source. Check `.env.local` (and the Vercel env for prod). A low value here silently truncates all feeds.
6. **`MAX_HACKATHON_DAYS` window (hackathon source only).** Events whose start→end span exceeds 120 days are dropped as perpetual "marathon" listings — enforced in `lib/fetchers/devpost.ts` and `lib/fetchers/dorahacks.ts`. Also: hackathon Luma discover items must match the `HACKATHON_NAME` regex and be virtual-or-CA/US (`lib/fetchers/luma.ts`, `fetchLumaHackathons`).

Special cases: `meetup` has NEVER stored a doc (0 in prod — paid actor, never live-verified end-to-end); `eventbrite` data ages out (paid, unscheduled). That is policy, not a bug — see `northbound-run-and-operate`. Fix routes: gate/config changes → `northbound-pipeline-engineering`; growing the Local lane / reviving eventbrite-meetup coverage → `northbound-coverage-campaign` (the decision-gated plan for exactly this symptom).

## S2. E11000 duplicate key during scrape

Two very different cases share this error. Discriminate by **which unique index fired**.

- **Benign (by design): `fingerprint_1`.** Two sources raced upserting the same event. `lib/scrape.ts` catches `err.code === 11000 && err.result` and folds the partial counts in — no error surfaces. Nothing to fix.
- **The silent-drop hole: `slug_1`.** Slug embeds title+date but **not city**. Two *different* events with the same title and date in different cities have different fingerprints (city is in the fingerprint) but the **same slug** — the second insert fails on `slug_1`, and the catch treats it as the benign case: **the event is silently lost**. `.claude/docs/gotchas.md` ("Duplicate key" section) prescribes discriminating via `err.keyPattern` and suffixing the slug on collision — **that fix was never implemented** (as of 2026-07-20 the catch checks only `code` + `result`; no `keyPattern` reference exists in `lib/` or `database/`). This is a real, open data-loss edge.

Discriminating experiment: temporarily log the bulk error detail where `lib/scrape.ts` catches it —
`console.warn(JSON.stringify((e as any).writeErrors?.map((w: any) => w.errmsg)))` — and look for
`index: slug_1` vs `index: fingerprint_1` in the messages. Note for the fix: on the bulkWrite path
the error is a `MongoBulkWriteError` whose `writeErrors[]` entries expose `code`/`index`/`errmsg`/`getOperation()`
but **not** `keyPattern` (verified in the installed mongodb driver, `node_modules/mongodb/lib/bulk/common.js`) —
gotchas.md's `err.keyPattern` recipe fits single-doc saves only; for bulk, parse `errmsg` or use `getOperation()`.

Fix route: slug-suffix-on-collision belongs to `northbound-pipeline-engineering` (slug format is
load-bearing — clear it with `northbound-architecture-contract` first). Background: the *original*
slug bug (bare-title slugs silently dropping every later occurrence of recurring series) is chronicled
in `northbound-failure-archaeology`.

## S3. Events dated one day off (or wrong time)

The UTC-shift class: an 8 PM Toronto event is next-day in UTC. Fixed 2026-06-10 — `normalizeDate`/`normalizeTime` (`database/normalize.ts`) extract wall-clock parts in the event's IANA timezone via `Intl.DateTimeFormat` (`partsInZone`), and date-only strings use local getters (zone-converting them is what used to shift the day). Verified behavior (2026-07-20):

```bash
npx -y tsx -e "import('./database/normalize').then(({default: n}) => console.log(n.normalizeDate('2026-07-15T20:00:00-04:00')))"   # → 2026-07-15
```

If it recurs, the bug is in a **mapper or fetcher**, not the helpers. Check in order:
1. Does the mapper pass a timezone? `normalizeDate(x)` defaults to `America/Toronto` — wrong for e.g. a Vancouver event whose source gives UTC instants without a zone.
2. Is the fetcher pre-formatting dates itself with `toISOString().split('T')[0]` or `getUTC*`? Forbidden pattern — route through `normalizeDate`/`normalizeTime`.
3. Faux-UTC sources: Tesla's `startDate` is a local calendar date encoded `T00:00:00+00:00` — NOT an instant; the adapter (`lib/fetchers/companies/tesla.ts`) treats it date-only. New sources may need the same treatment (`northbound-source-platforms-reference`).

Old rows scraped before a mapper fix stay wrong until the next scrape `$set`s them (upsert matches fingerprint; fingerprint contains the *wrong* date, so a date-fix creates a NEW doc and orphans the old one — cleanup needs an approved write, see `northbound-run-and-operate` prod-DB etiquette).

## S4. Price shows "[object Object]" (or broken price)

Cause (fixed for Luma, commit `ded4973`): Luma's `ticket_info.price` is `{cents, currency}` — occasionally a number or string — and a naive `String(price)` renders the object. Now handled by `lumaPrice()` in `database/normalize.ts` (currency-symbol map, `cents/100`, returns `undefined` for 0/absent). If you see this symptom: it's either (a) a NEW source whose mapper stringifies an object price — fix in that mapper, same pattern (`northbound-pipeline-engineering`); or (b) a stale stored row predating the fix — re-scrape repairs it via `$set` since the fingerprint is unchanged.

## S5. Register link 404s as `https://lu.ma/https://...`

Cause (fixed, commit `0c493c9`): Luma's `url` field is usually a bare slug, but externally-hosted events (YC, Google, CerebralValley calendars) put a FULL URL there, and the mapper unconditionally prefixed `https://lu.ma/`. Guard now in `mapLumaEvent` (`database/normalize.ts`): prefix only when the value doesn't match `/^https?:\/\//i`. If seen again, check (a) a stale stored row (re-scrape repairs), or (b) a new mapper repeating the unconditional-prefix mistake.

## S6. Company fetcher 403s — curl lies

**Tesla and Databricks return 403 to every curl request regardless of headers** — Akamai/Cloudflare TLS-fingerprint the client. Node's native `fetch` with a browser UA passes, which is exactly the production runtime. Re-verified live 2026-07-20 on the Databricks page-data endpoint: curl → 403, Node fetch → 200.

Discriminating experiment (any suspect endpoint):

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 "$URL"          # may 403 even when healthy
npx -y tsx -e "fetch('$URL',{headers:{'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'}}).then(r=>console.log(r.status))"
```

**Only the Node result is meaningful.** Rule: smoke-test adapters with `npx tsx`, never curl. Related identity rules: NVIDIA and Figma robots-block AI-crawler UA tokens, so those adapters use `BROWSER_UA` from `lib/fetchers/companies/shared.ts` instead of the default `NorthboundBot/1.0` UA (`lib/fetchers/util.ts`). Full per-platform anti-bot reality: `northbound-source-platforms-reference`.

## S7. Google devsite events: garbage ids / wrong-language titles

`developers.google.com/events` randomly serves machine-translated variants (th/pt-BR/ko observed on back-to-back requests), which translates away the h3 slugs used as event ids → events duplicate/vanish between scrapes. Fix in place: `lib/fetchers/companies/google.ts` pins `?hl=en` in the `PAGE` const AND sends `accept-language: en-US,en;q=0.9`. If the symptom returns, verify both pins survived any edit, then suspect a devsite layout change (compare the gallery HTML against the adapter's parsing).

## S8. Vercel build fails on `/_not-found`

Class: a **build-time DB read from globally-rendered UI**. `/_not-found` is statically prerendered at build; the global `Footer` (and home page) call `getScrapeStatus()`, which hits Mongo — on a build machine `MONGODB_URI` may be absent or Atlas unreachable, and an uncaught throw kills the build (happened; fixed in commit `2b8c7b9`).

Doctrine (`lib/meta.ts`): `getScrapeStatus()` wraps EVERYTHING in try/catch and degrades to `{lastRunAt: null, basis: 'none'}` → no badge. **Any new DB read reachable from the root layout/Footer/not-found scope must be fail-safe the same way.** If this build failure appears, someone added a non-fail-safe read — find it in the build stack trace and wrap-or-move it.

Reproduce/regression-test locally: run `npm run build` with `MONGODB_URI` unset — it must succeed.

## S9. Scroll jank returned

The scroll-perf conventions were bought with a 4-commit saga (`ded4973`→`0b21f84`→`6a886a4`→`40b8c19`→`63a965a`; full story: `northbound-failure-archaeology`). Jank returning means one of these was reintroduced — check the recent diff for exactly these, in likelihood order:

| Do NOT reintroduce | Why | Settled pattern |
|---|---|---|
| `backdrop-filter` blur on the sticky header / fixed backdrop | re-blurs everything scrolling beneath, every frame | `.glass` is SOLID `bg-[#0a0b0d]/90` (`@utility glass`, `app/globals.css`); `components/Backdrop.tsx` is a static gradient, no filter, no WebGL |
| `content-visibility` utilities (`cv-card`/`cv-row`) | render/unrender churn fights Lenis's rAF loop | none applied anywhere |
| React-state image fade-in | a screenful of `onLoad`s cascades re-renders mid-scroll | `components/EventImage.tsx` mutates `element.style.opacity` in `onLoad`/ref; React state changes only on error |
| Full-res scraped images | dominant decode/paint cost | always proxy via images.weserv.nl width-capped WebP (`resized()` in `EventImage.tsx`) |
| Scroll-driven `.reveal` animations | per-frame scroll-linked work | removed |

**Trap:** the loser CSS is still *defined* in `app/globals.css` (`cv-card`/`cv-row` utilities, `.reveal` keyframes, `.skeleton-overlay`) with zero consumers, as of 2026-07-20. Do not "wire it back up" because it looks unused-by-accident — it is dead by decision. UI conventions and design law: `northbound-frontend-engineering`.

## S10. `npm run lint` exits 1

**Known-red baseline** — re-verified 2026-07-20: exit 1. One real error (`react-hooks/purity` — `Date.now()` called during render in `components/FreshnessBadge.tsx`, the staleness computation) plus a warning bulk from untracked `.claude/` scripts that `eslint.config.mjs` does not ignore. Current exact counts, causes, and the fresh-clone caveat (a fresh clone lints far fewer files): `northbound-build-and-env` — that skill owns the numbers; do not hard-code them here.

Triage rule: **do not interpret exit 1 as your change failing.** Diff your lint output against this baseline; only NEW problems are yours. The de-facto type gate is `npx tsc --noEmit` (passes clean), and `next build` does not run ESLint in Next 16. Environment/toolchain detail: `northbound-build-and-env`. Fixing the baseline (badge refactor, eslint ignores) is a real change — branch + approval per `northbound-change-control`.

## S11. `GET /api/events?source=hackathon` silently returns everything

Known layer divergence (as of 2026-07-20): the route's whitelist `SOURCES` in `app/api/events/route.ts` has 5 values (`luma, eventbrite, meetup, mlh, company`) — **`hackathon` is missing** — while `lib/events.ts` `SOURCES` has all 6. An unlisted `source` param is silently ignored (no error, filter dropped), so the API returns the unfiltered feed while the /events *page* (which uses `lib/events.ts`) filters correctly. 139 live docs carry `source:'hackathon'` (2026-07-19 count).

Workaround: query `?category=hackathon` (or its synonym `?type=hackathon`) — `hackathon` IS in the route's `CATEGORIES`. This is one instance of a broader documented drift between `/api/events` and `lib/events.ts` (default date scope, clamps, projections) — the full divergence table has ONE home: `northbound-frontend-engineering` ("API routes as-built"); `northbound-architecture-contract` W2 keeps only a summary. Fix decisions route through `northbound-change-control`.

## S12. Connected to Mongo but collections look empty

**The db-path trap.** The real `MONGODB_URI` values end at `/` with no database path, so Mongoose defaulted to db **`test`** — that's where ALL production data lives. `.env.example` shows `...mongodb.net/events_site` as the template, but **no `events_site` database exists** (re-verified live 2026-07-20: cluster databases are `sample_mflix`, `test`, `admin`, `local`). Anyone who "fixes" their URI to match the template connects to an empty void.

First check (read-only MongoDB MCP): `mcp__mongodb__list-databases`, then `mcp__mongodb__count {database:'test', collection:'events'}` — 473 docs as of 2026-07-20. Collections in `test`: `events`, `bookings` (0 docs), `meta` (1 doc). Do NOT create `events_site` or migrate data to "fix" this — that's a prod-DB structural change requiring explicit approval (`northbound-change-control`). Env-var catalog: `northbound-build-and-env`.

## S13. Freshness badge stale or missing

The chain: `FreshnessBadge` (amber dot when >2 days stale, `components/FreshnessBadge.tsx`) ← `getScrapeStatus()` (`lib/meta.ts`) ← meta doc `{key:'scrape'}` in `test.meta` ← written by `POST /api/refresh` ← triggered nightly by `.github/workflows/scrape.yml` (cron `'15 7 * * *'`).

First check — read the meta doc: `mcp__mongodb__find {database:'test', collection:'meta', filter:{key:'scrape'}}`. Interpret:

| Observation | Meaning |
|---|---|
| `lastRunAt` old | the cron hasn't reached prod — see next table |
| `lastErrors` non-empty | last run partially failed; the messages name the source |
| a source missing from `perSource` | never run since 2026-06-21 (expected for `eventbrite`/`meetup` — paid, unscheduled) |
| `basis: 'derived'` in app logs | meta doc missing/empty; badge is faking it from newest `Event.updatedAt` |
| badge absent entirely | `getScrapeStatus` degraded to EMPTY (DB unreachable) — badge renders `null` when `lastRunAt` is null |

**Nuance (verified in `app/api/refresh/route.ts`):** `perSource.<source>` is written for every *requested* source whether or not it errored — it is last-ATTEMPTED, not last-succeeded (despite `lib/meta.ts`'s "last-success" docstring). Cross-check `lastErrors` before trusting a fresh timestamp.

If `lastRunAt` is old, check the cron: `gh run list --workflow=scrape.yml --limit 5`. Trap: when the `SITE_URL`/`CRON_SECRET` repo secrets are missing, scheduled runs **skip with a warning and stay green/neutral** — they do not go red (`Check configuration` step in `scrape.yml`). A green history can hide a never-configured cron. As of 2026-07-19 the cron IS live (meta showed a same-day run with `perSource` entries seconds apart in scrape.yml's loop order). Cron/deploy operations: `northbound-run-and-operate`.

## S14. `/events/SLUG` 404s on the page but resolves via the API

Slug-case inconsistency (as of 2026-07-20): slugs are STORED lowercase (schema `lowercase: true` on `slug` in `database/event.model.ts`, and `generateSlug` lowercases). The API route lowercases the incoming param (`slug.toLowerCase()` in `app/api/events/[slug]/route.ts`) — but the page path does not: `getEventBySlug` (`lib/events.ts`) does an exact `findOne({slug})`, so `/events/My-Event-2026-08-20` hits `notFound()` while `/api/events/My-Event-2026-08-20` returns the event.

Fix is a one-liner (lowercase in `getEventBySlug`) — route to `northbound-frontend-engineering`; don't "fix" it by un-lowercasing the API.

## When NOT to use this skill

- **The story behind a failure** (full incident chronicles, dead ends, why something was removed) → `northbound-failure-archaeology`.
- **Actually changing the pipeline** (fetchers, mappers, schema, dedup, config) → `northbound-pipeline-engineering`.
- **UI/API-surface changes** (pages, filters, components, design compliance, PostHog) → `northbound-frontend-engineering`.
- **Running things** (dev server, scrapes, the cron, deploys, paid-source protocol, prod-DB etiquette) → `northbound-run-and-operate`.
- **Environment won't build / env vars / fresh clone** → `northbound-build-and-env`.
- **Measuring health** (source-health/coverage/db-sanity scripts and their interpretation) → `northbound-diagnostics-and-tooling`.
- **"Am I allowed to do X?"** (gates, approvals, ADRs) → `northbound-change-control`.
- **How a platform exposes data** (endpoints, raw shapes, robots/anti-bot per source) → `northbound-source-platforms-reference`.
- **Growing the Local lane / reviving eventbrite-meetup coverage** (thin-by-policy, not broken) → `northbound-coverage-campaign`.
- **System invariants / why it's built this way** → `northbound-architecture-contract`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` + commands run and verified in-session (lint re-run; tsx one-liners executed; curl-vs-fetch re-tested live against Databricks; live DB re-checked read-only via MongoDB MCP). Counts labeled 2026-07-19 were measured that day and not re-measured — re-derive them with the table below rather than citing the measurement session. The slug-collision silent drop (S2) is an **open** hole; the `/api/events` hackathon whitelist gap (S11), db-`test` trap (S12), lint baseline (S10), and slug-case 404 (S14) are **open** known states — if any got fixed since, the table below detects it.

| Volatile fact | Re-verify with |
|---|---|
| E11000 catch still ignores which index fired (S2 hole open) | `grep -n "keyPattern\|11000" lib/scrape.ts` — hole open if no `keyPattern`/`writeErrors` handling |
| Slug still excludes city | `grep -n "generateSlug" lib/scrape.ts` — expect `` generateSlug(`${doc.title} ${doc.date}`) `` |
| Route whitelist still omits `hackathon` (S11) | `grep -n "^const SOURCES" app/api/events/route.ts lib/events.ts` |
| Page path still doesn't lowercase slugs (S14) | `grep -n "toLowerCase" lib/events.ts app/api/events/\[slug\]/route.ts` |
| Lint still red by known baseline (S10; counts owned by `northbound-build-and-env`) | `npm run lint 2>&1 \| tail -3` |
| eslint ignores still exclude only Next outputs | `grep -A5 globalIgnores eslint.config.mjs` |
| Prod data still in db `test`, no `events_site` | MCP `mcp__mongodb__list-databases` (read-only) |
| Free-source list / single nightly cron unchanged | `grep -n "cron:\|sources=luma" .github/workflows/scrape.yml` |
| `SCRAPE_MAX_ITEMS` default 50, `MAX_HACKATHON_DAYS` 120 | `grep -n "MAX_HACKATHON_DAYS =\|export const MAX_ITEMS" lib/fetchers/config.ts` |
| Dead CSS still unconsumed (S9 trap) | `grep -rn "cv-card\|cv-row\|skeleton-overlay" app components --include='*.tsx'` — expect no hits |
| `hl=en` + accept-language still pinned (S7) | `grep -n "hl=en\|accept-language" lib/fetchers/companies/google.ts` |
| `getScrapeStatus` still fail-safe (S8) | `grep -n "catch" lib/meta.ts` — expect a hit inside `getScrapeStatus` |
| perSource still written per-request (not per-success) | `grep -n "perSource" app/api/refresh/route.ts` |
