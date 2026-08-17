---
name: northbound-pipeline-engineering
description: Runbook for changing Northbound's scrape pipeline — adding/editing event sources, company registry entries, platform adapters, hackathon providers, normalization mappers, the Event schema, fingerprint dedup, and scrape config (lib/scrape.ts, lib/fetchers/*, database/*). Load for tasks like "add company X", "add a new source/platform", "events are duplicated/missing/wrong city", "change SCRAPE_MAX_ITEMS", "how does the Apify client (runActor) enforce billing caps", or any Mongoose 9 / bulkWrite upsert question. Triggering/running scrapes belongs to northbound-run-and-operate. Replaces the stale legacy event-scraping, apify-actors, data-schema, deduplication, and database skills — do not follow those.
---

# Northbound pipeline engineering

The scrape pipeline turns six event sources into deduplicated docs in the `events`
collection on Atlas. This file is the verified map of how it works and the checklists
for changing it. All claims verified against code as of 2026-07-20.

**Hard gates that bind every task here** (full rules: `northbound-change-control`):

- **G1 $0 hosting** — eventbrite/meetup run PAID Apify actors. Never schedule them; get
  gordon's explicit approval before ANY actor run; always set the `?maxItems=` RUN option.
- **G2 prod DB is sacred** — the live Atlas cluster IS production; there is no staging.
  Every scrape run writes to it. The scrape pipeline is the only sanctioned write path;
  anything else (deletes, backfills) needs explicit approval + a backup step.
- **G4** — branch first; commit/push only when asked; no AI attribution.

## End-to-end flow

```
POST /api/refresh  (Bearer CRON_SECRET; optional body {"sources":[...]})
  └─ runScrape()                              lib/scrape.ts
       for each source in FETCHERS:
         raw[] = FETCHERS[source]()           lib/fetchers/<source>.ts
         for each item:
           doc = normalizeRawEvent(item, src) database/normalize.ts  (mapper + cleanTitle + classifyRegion)
           drop if doc.region === 'INTL'      (North-America scope gate)
           company only: drop isConsumerEvent; DEV_ONLY_COMPANIES also need isRelevant
           fingerprint = buildFingerprint(doc)  database/fingerprint.ts
         Event.bulkWrite(ops, { ordered: false })
           updateOne { filter: {fingerprint},
                       update: { $set: doc,
                                 $setOnInsert: { fingerprint, slug: generateSlug(`${title} ${date}`) } },
                       upsert: true }
         err.code === 11000 → absorbed as benign dedup race (see caveat below)
```

### File map

| File | Role |
|---|---|
| `lib/scrape.ts` | `runScrape` — FETCHERS registry (6 sources), gates, bulkWrite upsert. Sole caller: `app/api/refresh/route.ts` |
| `lib/fetchers/config.ts` | ALL tunable config: caps, city slugs, the 38-entry company registry. Client-importable (CompanyDirectory.tsx imports it) — never add secrets or `server-only` here |
| `lib/fetchers/luma.ts` | Free direct `api.lu.ma` JSON: city discover feeds, calendar feeds, hackathon category feeds |
| `lib/fetchers/eventbrite.ts` | PAID Apify actor `parseforge/eventbrite-scraper`, one run per city |
| `lib/fetchers/meetup.ts` | PAID Apify actor `easyapi/meetup-events-scraper`, ONE batched run (flat start fee). **Never live-verified end-to-end** (credit exhausted 2026-06; still open as of 2026-07-20) |
| `lib/fetchers/mlh.ts` | Free fetch of mlh.io season pages, balanced-bracket JSON extraction |
| `lib/fetchers/company.ts` | `fetchCompany` — PROVIDERS map (generic `luma`/`tribe` + 9 bespoke), per-company error isolation |
| `lib/fetchers/companies/*.ts` | 9 bespoke platform adapters (google, aws, reactor, yc, nvidia, tesla, databricks, snowflake, figma), all emitting `CompanyStdEvent` from `companies/shared.ts` |
| `lib/fetchers/hackathons.ts` | `fetchHackathons` — providers array: devpost, luma (categories), dorahacks, ethglobal |
| `lib/fetchers/apify.ts` | `runActor` — the billing-hardened Apify REST client |
| `lib/fetchers/relevance.ts` | `isRelevant` (broad-feed keyword gate), `isConsumerEvent`, `deriveTags` (always prepends `'tech'`) |
| `lib/fetchers/geo.ts` | `classifyRegion` (region CA/US/ONLINE/INTL/UNKNOWN), `cleanTitle` |
| `lib/fetchers/util.ts` | `getJSON`/`getText` (NorthboundBot UA), `stripHtml` |
| `database/normalize.ts` | `normalizeRawEvent` + per-source mappers; ONE `mapStdCompanyEvent` mapper covers every `_std` company/hackathon adapter |
| `database/fingerprint.ts` | `buildFingerprint` = sha256 of normalized `title|date|city` |
| `database/event.model.ts` | Event schema + indexes + `generateSlug` + pre-save hook (which does NOT run on this path) |
| `database/index.ts` | Barrel: `Event`, `generateSlug`, `buildFingerprint`, `normalizeRawEvent`, types |

Error isolation is three layers deep — per-source (runScrape), per-item (flatMap
try/catch), per-provider/city/page inside each fetcher — so one dead endpoint degrades
to a `console.warn`, never a failed run.

## Upsert semantics — read before touching scrape.ts

Stated honestly, as-built (`lib/scrape.ts`):

1. **Match on `fingerprint`; `$set` the WHOLE normalized doc on every rescrape.** Only
   `fingerprint` and `slug` are `$setOnInsert`. Consequence: when the same event is seen
   by multiple sources (same title+date+city ⇒ same fingerprint), **the last source to
   scrape wins every field — including `source`**, silently reassigning provenance.
   This is documented as-built behavior AND a flagged open question — do not "fix" it
   casually; route through `northbound-change-control`.
2. **Pre-save hooks and schema validators do NOT run here.** `bulkWrite` updateOne ops
   are cast but not validated and skip `pre('save')` — that's why `normalize.ts` does all
   normalization up front, `scrape.ts` derives the slug itself, and mappers enforce their
   own limits (`slice(0,100)` title, `slice(0,1000)` description). Several mappers
   legitimately store `image: ''` despite the schema's `required` rule (e.g. ethglobal,
   whose banner URLs are 1-hour presigned).
3. **Slug embeds the date**: ``generateSlug(`${doc.title} ${doc.date}`)`` — recurring
   series (Microsoft Reactor, Figma webinars) reuse titles across dates; a bare-title
   slug collided on the unique slug index and silently dropped every later occurrence.
4. **E11000 is absorbed as benign** (`err.code === 11000 && err.result` → counts
   accumulated, no error recorded). Rationale: two sources racing on one fingerprint.
   **Known hole (open, as of 2026-07-20)**: the unique SLUG index can also throw E11000 —
   two *different* events with the same title+date in *different cities* have different
   fingerprints but identical slugs (slug omits city), so the loser is silently dropped
   and miscounted as a benign race. `.claude/docs/gotchas.md` prescribes discriminating
   via `err.keyPattern`; the code never adopted it. If you hit unexplained missing
   events, check this first (see `northbound-debugging-playbook`).
5. **Rescrape never deletes.** Gated/vanished items are simply skipped, so stale docs
   (e.g. pre-canonicalization `Montréal` rows) persist until manually removed. Deletes
   need approval + a `npx tsx` script — the MongoDB MCP is `--readOnly` (G2).

## Checklist A — add a company on an existing platform (1 line)

Everything is one entry in `COMPANY_SOURCES` in `lib/fetchers/config.ts`. Real examples
in the file today:

```ts
{ provider: 'luma',  company: 'Cohere', industry: 'AI Labs', calendarApiId: 'cal-400NOkbFqzrkJNA' },
{ provider: 'tribe', company: 'Vector Institute', industry: 'Research', base: 'https://vectorinstitute.ai', city: 'Toronto' },
```

1. Pick the provider. Generic: `luma` (any Luma calendar), `tribe` (any WordPress site
   running "The Events Calendar" — `company.ts` hits `${base}/wp-json/tribe/events/v1/events?per_page=50`).
2. **Luma: pin `calendarApiId`, don't trust the vanity slug.** Slug squatting is rampant —
   `lu.ma/cohere` is a coliving community, `lu.ma/modal` is unrelated to Modal Labs.
   Resolve and verify the calendar's display name first:
   `curl -s 'https://api.lu.ma/url?url=<slug>'` → `kind: 'calendar'` →
   `data.calendar.api_id` (`cal-…`) + name. Only `Notion Toronto` uses a bare `slug` today.
3. `industry` must be one of the `Industry` union values (config.ts): `AI Labs`,
   `ML & Data`, `Dev Tools`, `Cloud & Infra`, `Big Tech`, `Startups & VC`, `Research`.
4. Add `devOnly: true` for consumer brands whose feed mixes retail noise — their events
   then additionally pass `isRelevant(title+description)` at scrape time (Tesla is the
   only such entry today).
5. Done. `COMPANY_DIRECTORY` (UI) and `DEV_ONLY_COMPANIES` derive automatically from
   `COMPANY_SOURCES`; the normalizer, schema, and scrape loop are untouched.
6. Verify: smoke-test the fetch (see "Testing a pipeline change"), then a scoped
   `{"sources":["company"]}` refresh.

## Checklist B — add a new company events platform (adapter file + 2 registrations)

The normalizer is NEVER touched: every bespoke adapter emits `CompanyStdEvent`
(`lib/fetchers/companies/shared.ts`) and `mapStdCompanyEvent` in `database/normalize.ts`
handles the whole shape, auto-namespacing `sourceId` as `${_provider}:${id}`.
Real example wiring: figma.

1. Create `lib/fetchers/companies/<platform>.ts`:
   ```ts
   export async function fetchX(src: { company: string }): Promise<CompanyStdEvent[]>
   ```
   (cf. `fetchFigma(src: { company: string })` in `companies/figma.ts`; providers with
   extra config take more, cf. `fetchYc(src: { company: string; slugs: string[] })`).
   Emit `_std: true`, `_provider: '<platform>'`, `_company: src.company`, plus `title`,
   `url`, `online`, and EITHER `startISO`/`endISO` + IANA `timezone` OR local
   `date`/`endDate`/`time`/`endTime` parts. Optional `_regions` hints feed the geo gate.
   Inside the adapter: cap at `MAX_ITEMS`, filter past events, use `BROWSER_UA` from
   `companies/shared.ts` if the site blocks bot UAs or TLS-fingerprints curl.
2. Add the provider literal to the `CompanySource` union in `config.ts`
   (the no-arg branch: `{ provider: 'google' | 'aws' | … | 'figma' }`).
3. Register in the `PROVIDERS` map in `lib/fetchers/company.ts` (import + one entry:
   `figma: fetchFigma`). Per-company error isolation comes free from `fetchCompany`.
4. Add company entries to `COMPANY_SOURCES` (Checklist A).

Adapter craft notes (each cost a debugging session — details in
`northbound-source-platforms-reference` and `.claude/docs/gotchas.md`): pin language
(`google.ts` uses `?hl=en` + `accept-language` because devsite randomly machine-translates),
never parse a non-JSON response as data (`dorahacks.ts` throws on WAF challenge pages),
don't persist presigned image URLs (`ethglobal.ts` stores `''`), treat faux-UTC dates as
local calendar dates (`tesla.ts`).

## Checklist C — add a hackathon provider (fetcher + 1 array entry)

Real example wiring: dorahacks.

1. Create `lib/fetchers/<provider>.ts` exporting
   `fetchX(): Promise<unknown[]>` that emits `CompanyStdEvent` items with
   `category: 'hackathon'` (typically also `isFree: true`). Apply inside the fetcher:
   upcoming-only, virtual-or-US/CA, start→end span ≤ `MAX_HACKATHON_DAYS`, `MAX_ITEMS` cap.
2. Add `['<name>', fetchX]` to the `providers` array in `lib/fetchers/hackathons.ts`.
   Per-provider isolation is free.
3. Luma-shaped feeds: skip the std shape and tag raws `_provider: 'luma'` + `_company`
   instead — `normalize.ts` then reuses the verified `mapLumaEvent` (this is exactly what
   `fetchLumaHackathons` in `luma.ts` does).
4. `normalize.ts` force-sets `category: 'hackathon'` for the whole source regardless, so
   items always land in the Hackathons lane.

## Checklist D — add an entirely new top-level source (6 touch points)

Count them — missing one produces silent filtering bugs, not errors:

1. `lib/fetchers/<source>.ts` — fetcher returning `Promise<unknown[]>`.
2. `lib/scrape.ts` — add to the `ScrapeSource` union AND the `FETCHERS` map.
3. `database/normalize.ts` — add to the **local** `type Source` union (top of file) AND
   a `case` in `mapRaw`.
4. `database/event.model.ts` — add to the `source` union in the `IEvent` interface AND
   the schema's `enum` array on the `source` field.
5. `lib/events.ts` — add to the `SOURCES` whitelist AND the `EventDoc.source` union.
6. `app/api/events/route.ts` — add to its `SOURCES` whitelist.

**Warning — the two whitelists currently disagree (as of 2026-07-20):** `lib/events.ts`
`SOURCES` has all six values, but `app/api/events/route.ts` `SOURCES` omits
`'hackathon'` — so `GET /api/events?source=hackathon` silently ignores the filter. Known
as-built defect; fix it via `northbound-change-control` when touching that file, and
don't replicate the omission.

Also consider (owned by siblings): lane mapping `laneOf()` + its duplicates
(`northbound-frontend-engineering`); adding a free source to the nightly cron's source
list in `.github/workflows/scrape.yml` (`northbound-run-and-operate`). A paid source may
NOT be scheduled at all (G1).

## Config catalog — lib/fetchers/config.ts

All constants live in this one file. "Prod" = exercised by the nightly cron;
"manual-paid" = live-verified but only run by hand; "unverified" = code path never
completed a live end-to-end run.

| Constant | Value (as of 2026-07-20) | Consumer | Effect | Status |
|---|---|---|---|---|
| `MAX_ITEMS` | `max(1, parseInt(SCRAPE_MAX_ITEMS ?? '50'))` — env-tunable | every fetcher | Universal per-source item cap: Luma `pagination_limit`, Eventbrite per-city split, Meetup run cap, Devpost page count, DoraHacks output cap | prod |
| `LUMA_CITY_SLUGS` | `['toronto','montreal','ottawa']` | `fetchLuma` | Luma city discovery feeds; quebec-city has no Luma discovery page (as of 2026-06) — Eventbrite/Meetup cover it | prod |
| `EVENTBRITE_CITIES` | 4 slugs, `canada--<city>` form (toronto, mississauga, ottawa, montreal) | `fetchEventbrite` | One PAID actor run per slug | manual-paid |
| `EVENTBRITE_CATEGORY` | `'science-and-tech'` | `fetchEventbrite` | Search category per run | manual-paid |
| `MEETUP_SEARCH_URLS` | 4 URLs = private `MEETUP_LOCATIONS` (`ca--on--Toronto`, `ca--on--Ottawa`, `ca--qc--Montréal`, `ca--qc--Québec`) × private `MEETUP_KEYWORDS` (`['tech']`) | `fetchMeetup` | All fed to ONE paid run; keep ≈4 URLs — the actor crawls ~1 min/URL against the client's 280 s poll deadline (`timeoutMs: 280_000`). Note the hosted function ceiling is an unresolved 60s-vs-300s contradiction (`northbound-architecture-contract` W6) — paid runs are localhost-only regardless. The location/keyword arrays are non-exported consts in config.ts | unverified |
| `MLH_SEASON_URLS` | 2026 + 2027 season pages | `fetchMlh` | A 404 season is skipped silently | prod |
| `MLH_PROVINCES` | `ON/Ontario/QC/Quebec/Québec` | `fetchMlh` | Keep in-person MLH events in these provinces; all `digital` ones kept | prod |
| `LUMA_HACKATHON_CATEGORIES` | `['cat-ai','cat-tech']` | `fetchLumaHackathons` | Luma has no hackathon category; hackathons hide in AI/Tech, name-matched by `HACKATHON_NAME` regex in luma.ts | prod |
| `MAX_HACKATHON_DAYS` | `120` | `devpost.ts`, `dorahacks.ts` | Drops perpetual "marathon"/template challenges (span > 120 days) | prod |
| `COMPANY_SOURCES` | **38 entries**: 9 bespoke-provider + 28 luma + 1 tribe | `fetchCompany`, UI directory | The whole company registry; Tesla is the only `devOnly: true` | prod |
| `COMPANY_DIRECTORY`, `DEV_ONLY_COMPANIES` | derived from `COMPANY_SOURCES` | UI / scrape gate | Never edit directly — they recompute | prod |
| `Industry`, `INDUSTRY_ORDER` | 7 buckets | config + UI | Directory grouping/order | prod |

Reminder: `config.ts` is imported by the client component `CompanyDirectory.tsx` — it
ships in the browser bundle. No secrets, no `server-only`, no Node-only imports.

## Normalization rules as-built (database/normalize.ts)

Order inside `normalizeRawEvent`: per-source mapper → `cleanTitle` → `classifyRegion` →
country override + non-NA collapse to `region: 'INTL'`.

- **Title**: each mapper slices to 100 chars (schema max); `stripHtml` where sources emit
  HTML/entities; then `cleanTitle` (geo.ts) decodes remaining entities, fixes
  run-together `x:y` → `x: Y`, collapses whitespace, strips space-before-punctuation.
- **City canonicalization** (`CITY_ALIASES`): `montréal → Montreal`;
  `québec` / `quebec` / `québec city` → `Quebec City`. Load-bearing for dedup — the
  fingerprint includes city, so a new alias spelling silently forks duplicates.
- **Date/time**: stored as STRINGS `YYYY-MM-DD` / `HH:MM` (24h). `normalizeDate`/
  `normalizeTime` extract wall-clock parts in the event's IANA timezone via
  `Intl.DateTimeFormat` (`hourCycle: 'h23'`) — never UTC-split (an 8 PM Toronto event
  must not roll to the next day). Date-only strings are read back with local getters.
  Lexical string compare on these IS chronological compare.
- **endDate/endTime**: optional; mapped when the source has them. `mapStdCompanyEvent`
  defaults `time` to `'09:00'` for date-only sources (no invented precision).
- **Timezone**: default `America/Toronto` (`DEFAULT_TZ`, also the schema default).
- **Price / isFree** per source: Luma — `ticket_info.is_free`; `lumaPrice()` renders
  `ticket_info.price` which is `{cents, currency}` (occasionally number/string) via a
  currency-symbol map — naive string use printed `[object Object]` once. Eventbrite —
  `pricing.isFree` / `pricing.priceDisplay`. Meetup — `isFree = feeSettings == null`.
  MLH + hackathon providers — `isFree: true`. Tribe — `price: raw.cost || undefined`.
  Std adapters pass through `isFree`/`price`.
- **Image** per source: Luma `cover_url ?? social_image_url ?? ''`; Eventbrite
  `images.medium ?? imageUrl`; Meetup `featuredEventPhoto.highResUrl ?? displayPhoto.highResUrl`;
  MLH `backgroundUrl ?? logoUrl`; ethglobal deliberately `''` (presigned URLs). Empty
  string is fine — validators don't run on the upsert path and the UI falls back.
- **Venue-is-URL quirk**: some Luma webinars are marked `offline` with a registration
  URL in the address — a URL venue forces `mode: 'online'` so it never renders as a place.
- **URL**: Luma `raw.url` may be a bare slug OR a full URL (externally-hosted events) —
  full URLs are not prefixed with `lu.ma/`.
- **Description**: `fallbackDescription(title, city, organizer)` when missing; sliced to
  1000 (schema max).
- **Tags**: `deriveTags` always prepends `'tech'` (satisfies the at-least-one-tag rule) —
  which is exactly why the Tesla relevance gate reads title+description, NOT tags.
- **Geo gate**: `classifyRegion` precedence: online → explicit country → US state → CA
  province → curated city table → `_regions` hints/TBA fallback. Bare `London` = UK/INTL;
  only `London, ON`/`Ontario` is Canadian. Mexico is INTL by product decision. Online and
  UNKNOWN locations are KEPT (default North-America true) unless `_regions` hints exclude NA.

## Schema as-built (database/event.model.ts)

- `source` enum has **SIX** values: `luma | eventbrite | meetup | mlh | company | hackathon`.
  (Older docs list five — `hackathon` is real and live.)
- `region?: 'CA' | 'US' | 'ONLINE' | 'INTL' | 'UNKNOWN'` — derived in normalize, persisted.
- `fingerprint?: string` — **optional field, unique SPARSE index** (sparse so hand-entered
  events without one don't collide on null).
- `slug` — unique + `lowercase: true` + `trim` via field options (no separate
  `schema.index()` — re-declaring caused a duplicate-index warning). Scraper slugs embed
  the event date.
- `date`/`time` are strings (see normalization). `timestamps: true` gives createdAt/updatedAt.
- Full index set, verified 2026-07-20 — the `{date, mode}` compound described in older
  docs is GONE:

  | Index | Options |
  |---|---|
  | `{ fingerprint: 1 }` | unique, sparse |
  | `{ mode: 1, date: 1 }` | |
  | `{ city: 1, date: 1 }` | |
  | `{ tags: 1, date: 1 }` | |
  | `{ region: 1, date: 1 }` | |
  | `{ date: 1, _id: 1 }` | |
  | `{ title: 'text', description: 'text', tags: 'text' }` | unweighted, default name |
  | slug unique | via field option |

- Pre-save hook is Mongoose 9 style (no `next()`; return to continue, throw to abort) and
  **never fires on the scraper's bulkWrite path** — it only matters for hand-created docs.
- No `autoIndex: false` is set — Mongoose default auto-index applies in prod (a
  gotchas.md recommendation that was never implemented; treat as candidate, not fact).

Schema changes are Type-3 territory: new optional fields are additive and safe; changing
`source`/`category`/`region` enums, the fingerprint recipe, or any unique index affects
stored data and needs `northbound-change-control` + a backfill plan (G2).

## Mongoose 9 deltas — copy-paste from older material WILL break

Installed: mongoose `^9.6.2` on mongodb driver `^7.2.0` (package.json, verified 2026-07-20).

- **`FilterQuery` is GONE — use `QueryFilter`.** Verified against
  `node_modules/mongoose/types/index.d.ts`: 0 occurrences of `FilterQuery`, 2 of
  `QueryFilter`. Repo usage: `import type { QueryFilter } from 'mongoose'` in
  `lib/events.ts` and `app/api/events/route.ts`. The legacy `database`/`backend-api`
  skills prescribe `FilterQuery` — it will not compile.
- **Middleware takes no `next` callback** — return to continue, throw to abort
  (see the pre-save hook in event.model.ts).
- Model guard pattern in use: `models.Event || model<IEvent>('Event', EventSchema)`
  (hot-reload safe).
- Connection: `connectDB` (database/mongodb.ts) caches on `global.mongoose`, sets
  `bufferCommands: false`, `maxPoolSize: 10`, `serverSelectionTimeoutMS: 10000`.
  `runScrape`'s contract is that the caller already awaited `connectDB()`.

## Apify invocation runbook (G1 gates baked in)

**Before ANY actor run: get gordon's explicit approval. Actor runs cost real money**
(pay-per-result + a start fee charged PER GB of memory). The incident that set these
rules: a 12-URL meetup run requested 20 items and billed ~10× its request (~$1.4–2; the
canonical dual account of the cost figures is `northbound-failure-archaeology` A4) —
because the actor's `maxItems` INPUT field is advisory and this actor ignores it. **Only
the `?maxItems=` RUN OPTION is a billing cap.**

The client is `runActor(actor, input, opts)` in `lib/fetchers/apify.ts`:

| Guard | Implementation |
|---|---|
| Billing cap | `opts.maxItems` → `?maxItems=` run option on the start request — ALWAYS set it |
| Start fee | `opts.memoryMb` → `?memory=` (meetup 2048 — peak observed ~1.3 GB, vs 4 GB actor default; eventbrite 1024) |
| Runaway runs | server-side `?timeout=` = `ceil(timeoutMs/1000)+30` — an abandoned client poll cannot leave a run billing |
| Token hygiene | `Authorization: Bearer $APIFY_TOKEN` header ONLY — never `?token=` (leaks into logs) |
| Flow | `POST /v2/acts/{owner~name}/runs?waitForFinish=60&…` → poll `GET /v2/actor-runs/{id}?waitForFinish=60` until terminal (`SUCCEEDED/FAILED/ABORTED/TIMED-OUT`) → `GET /v2/datasets/{defaultDatasetId}/items?clean=true&format=json` |

Actors in use: `parseforge/eventbrite-scraper` (one run per `EVENTBRITE_CITIES` slug,
`maxItems = max(5, floor(MAX_ITEMS/4))`), `easyapi/meetup-events-scraper` (ONE run for
all `MEETUP_SEARCH_URLS`, `timeoutMs: 280_000`). **The meetup path has never completed a
live end-to-end pipeline run** — item shape was verified from actor test data, but treat
any meetup work as validating an unproven path, not extending a proven one.

Inspect the most recent run without knowing its id (standard Apify REST, not exercised
from this repo):
`curl -s -H "Authorization: Bearer $APIFY_TOKEN" 'https://api.apify.com/v2/acts/easyapi~meetup-events-scraper/runs/last'`

The paid-run protocol (when to run, budget accounting, what to tell gordon) lives in
`northbound-run-and-operate`.

## Testing a pipeline change

1. **Typecheck**: `npx tsc --noEmit` (verified clean 2026-07-20). Then `npm run lint` —
   but note the lint baseline is NOT clean (1 error, 135 warnings as of 2026-07-20):
   your bar is "no NEW findings in files you touched", not exit 0. Details in
   `northbound-build-and-env`.
2. **Smoke-test a fetcher WITHOUT writing to prod** — dry-run fetch + normalize in a
   throwaway script (scratch dir, not the repo), inspect output, never call `bulkWrite`:
   ```ts
   // npx tsx smoke.ts — tsx compiles .ts as CJS: wrap awaits in an async IIFE
   import { fetchDevpost } from './lib/fetchers/devpost';
   import { normalizeRawEvent } from './database';
   (async () => {
     const raw = await fetchDevpost();
     console.log(raw.length, JSON.stringify(normalizeRawEvent(raw[0], 'hackathon'), null, 2));
   })();
   ```
   **Use `npx tsx`, never curl, to probe endpoints** — Tesla/Databricks sit behind
   TLS-fingerprinting CDNs that 403 every curl request while Node's fetch (the actual
   production runtime) passes.
3. **Scoped live run** (writes to PROD Atlas — sanctioned path, but only run it once the
   dry-run output looks right):
   ```bash
   curl -X POST http://localhost:3000/api/refresh \
     -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
     -d '{"sources":["company"]}'
   ```
   Omitting the body runs ALL six sources including the paid ones — never do that
   without approval. Full run/operate protocol: `northbound-run-and-operate`.
4. **Verify what landed** read-only via the MongoDB MCP (`--readOnly`) or the shipped
   diagnostics — interpretation guides in `northbound-diagnostics-and-tooling`.

## When NOT to use this skill

- Triggering scrapes, the nightly cron, deploys, prod-DB etiquette, the paid-source
  approval protocol → `northbound-run-and-operate`.
- UI/pages/filters/lanes/API-surface consumers, `laneOf` and its duplicates, calendar
  export, PostHog → `northbound-frontend-engineering`.
- "Why is X broken?" symptom triage → `northbound-debugging-playbook`; history of past
  failures/removals → `northbound-failure-archaeology`.
- How each platform exposes data, robots/anti-bot reality, date/tz/geo/dedup theory →
  `northbound-source-platforms-reference` (this file only covers what the code does).
- Whether a change is allowed and how to gate it (schema migrations, the last-source-wins
  and slug-hole open questions, ADRs) → `northbound-change-control`.
- Environment setup / env-var catalog → `northbound-build-and-env`; measurement scripts →
  `northbound-diagnostics-and-tooling`; evidence bar for claiming a source "works" →
  `northbound-validation-and-qa`.
- Growing local coverage at $0 (which sources to add next) → `northbound-coverage-campaign`.
- The legacy `event-scraping`, `apify-actors`, `data-schema`, `deduplication`, `database`
  skills are superseded by THIS file — do not follow them (they prescribe SWR, Luma via
  Apify, `FilterQuery`, and a vercel.json cron, none of which match the code).

## Provenance and maintenance

Authored 2026-07-20 from repo state + verified commands: every file, identifier,
constant, and count above was read or grepped in the working tree on 2026-07-20
(`npx tsc --noEmit` and the greps below were actually run). Incident details
(the meetup billing overrun, slug-collision series loss, UTC date-shift) come from
`.claude/docs/gotchas.md`, `.claude/docs/decisions.md` (ADR-005/009/010/013/015/017),
and commit messages (`4d3317d`, `ded4973`), cross-checked against the present code.

Volatile facts — re-verify before relying on them:

| Fact (as of 2026-07-20) | One-line re-verification |
|---|---|
| 6 sources in FETCHERS | `grep -n "FETCHERS" lib/scrape.ts` |
| Upsert: `$set` whole doc, `$setOnInsert` fingerprint+slug | `grep -n '\$setOnInsert' lib/scrape.ts` |
| E11000 absorbed benign (slug hole unfixed) | `grep -n "11000\|keyPattern" lib/scrape.ts` |
| 38 entries in COMPANY_SOURCES | `grep -c "company: '" lib/fetchers/config.ts` |
| MAX_ITEMS default 50 via SCRAPE_MAX_ITEMS | `grep -n "SCRAPE_MAX_ITEMS" lib/fetchers/config.ts` |
| MAX_HACKATHON_DAYS=120, used by devpost+dorahacks | `grep -rn "MAX_HACKATHON_DAYS" lib/fetchers/` |
| CompanySource provider union (9 bespoke + luma + tribe) | `grep -n "provider:" lib/fetchers/config.ts \| head -5` |
| Hackathon providers: devpost, luma, dorahacks, ethglobal | `grep -n "providers" lib/fetchers/hackathons.ts` |
| source enum has 6 values incl. hackathon | `grep -n "enum: \['luma'" database/event.model.ts` |
| Index set (no {date,mode}; fingerprint unique sparse) | `grep -n "index(" database/event.model.ts` |
| API SOURCES whitelist still omits 'hackathon' | `grep -n "const SOURCES" app/api/events/route.ts lib/events.ts` |
| Mongoose 9: QueryFilter yes, FilterQuery no | `grep -c "FilterQuery" node_modules/mongoose/types/index.d.ts` (expect 0) |
| mongoose ^9.6.2 / mongodb ^7.2.0 | `node -e "p=require('./package.json');console.log(p.dependencies.mongoose,p.dependencies.mongodb)"` |
| Apify guards: maxItems/memory/timeout run options | `grep -n "maxItems\|memory\|timeout" lib/fetchers/apify.ts` |
| Actors: parseforge/eventbrite-scraper, easyapi/meetup-events-scraper | `grep -n "const ACTOR" lib/fetchers/eventbrite.ts lib/fetchers/meetup.ts` |
| CITY_ALIASES (Montréal→Montreal etc.) | `grep -n -A4 "CITY_ALIASES" database/normalize.ts` |
| Meetup path still unverified end-to-end | check `.claude/docs/decisions.md` follow-ups + ask before assuming a run completed |
