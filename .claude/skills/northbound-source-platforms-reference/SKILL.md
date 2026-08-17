---
name: northbound-source-platforms-reference
description: Domain reference for how each event platform feeding Northbound actually exposes data — Luma (api.lu.ma), MLH, Devpost, DoraHacks, ETHGlobal, the 11-provider company registry (Google/AWS/Reactor/YC/NVIDIA/Tesla/Databricks/Snowflake/Figma + luma/tribe), and the paid Apify actors for Eventbrite/Meetup. Load when you need endpoint URLs, raw field shapes, anti-bot/robots reality (curl 403s, UA rules), date/timezone semantics (faux-UTC, wall-clock extraction), geo/region classification, or fingerprint-dedup theory for any Northbound scrape source.
---

# Northbound source platforms reference

How each platform exposes event data, **as implemented in this repo** — endpoints, raw shapes, and the traps that were learned the hard way. Every claim below is verified against the fetcher code as of 2026-07-20. This is the "what the outside world looks like" pack; the runbook for *changing* fetchers is `northbound-pipeline-engineering`.

**Terms (defined once):**

| Term | Meaning |
|---|---|
| source | One of the 7 keys in the `FETCHERS` registry (`lib/scrape.ts`): `luma`, `eventbrite`, `meetup`, `mlh`, `company`, `hackathon`, `watchlist` (added 2026-08-16, ADR-019) |
| fetcher | A `() => Promise<unknown[]>` in `lib/fetchers/` returning raw platform items |
| raw item | Platform-shaped object a fetcher emits; mapped to the canonical Event by `normalizeRawEvent` (`database/normalize.ts`) |
| `CompanyStdEvent` | The shared intermediate shape (`lib/fetchers/companies/shared.ts`) every bespoke company/hackathon adapter emits (`_std: true`), so `normalize.ts` needs exactly one mapper for all of them |
| `MAX_ITEMS` | Universal per-source cap: `max(1, parseInt(SCRAPE_MAX_ITEMS ?? '50'))` in `lib/fetchers/config.ts` |
| run option | An Apify query param on the run-start request (`?maxItems=`, `?memory=`, `?timeout=`) — billing-enforced, unlike actor INPUT fields which are advisory |

## The seven sources at a glance

| Source | Mechanism | Cost | File |
|---|---|---|---|
| `luma` | Direct unauthenticated `api.lu.ma` JSON (city discovery feeds) | Free | `lib/fetchers/luma.ts` |
| `mlh` | Plain fetch of season-page HTML (`www.mlh.com`), balanced-bracket JSON extraction | Free | `lib/fetchers/mlh.ts` |
| `hackathon` | Aggregate: Devpost (online + in-person) + Luma AI/Tech discover + DoraHacks + ETHGlobal | Free | `lib/fetchers/hackathons.ts` |
| `watchlist` | Curated named hackathons polled off their own official sites (added 2026-08-16, ADR-019) | Free | `lib/fetchers/watchlist.ts` + `lib/data/watchlist.ts` |
| `company` | 38-entry registry → 11 provider adapters (2 generic + 9 bespoke) | Free | `lib/fetchers/company.ts` + `companies/` |
| `eventbrite` | Apify actor `parseforge/eventbrite-scraper` | **Paid** | `lib/fetchers/eventbrite.ts` |
| `meetup` | Apify actor `easyapi/meetup-events-scraper` | **Paid** | `lib/fetchers/meetup.ts` |

Paid sources are never scheduled (G1: $0 hosting). Any Apify actor run needs gordon's explicit approval first — see `northbound-run-and-operate` for the protocol.

## Luma (api.lu.ma) — free public JSON, no auth

ADR-009 (`.claude/docs/decisions.md`) superseded the Apify Luma actor: `api.lu.ma` answers unauthenticated JSON for everything needed. It is an *unofficial* API — if it locks down, the fallback is the ADR-004 actor.

**Endpoints actually hit** (`lib/fetchers/luma.ts`, base `https://api.lu.ma`):

| Endpoint | Used for | Notes |
|---|---|---|
| `/url?url=<slug>` | Resolve a slug to `kind: 'discover-place'` or `'calendar'` | toronto/montreal resolve discover-place; ottawa resolves calendar (as of 2026-06). Any other kind (user pages) throws |
| `/discover/get-paginated-events?discover_place_api_id=<id>&pagination_limit=N` | City discovery feeds | `LUMA_CITY_SLUGS = ['toronto','montreal','ottawa']` — `quebec-city` 404s (no discovery page as of 2026-06) |
| `/calendar/get-items?calendar_api_id=<cal-…>&period=future&pagination_limit=N` | Company/community calendars | Used by the `company` source's generic `luma` provider |
| `/discover/get-paginated-events?discover_category_api_id=<cat-…>&pagination_limit=N` | Category feeds | `LUMA_HACKATHON_CATEGORIES = ['cat-ai','cat-tech']` feed the hackathon source; lu.ma has no hackathon category so hackathons hide in AI/Tech, name-matched by the `HACKATHON_NAME` regex in `luma.ts` |

**Raw shape** (entries nest `{event, calendar, hosts, ticket_info}`; the fetcher's `flatten()` merges entry-level context onto the event object):

- `api_id` — stable event id (used as `sourceId` and for in-run dedup)
- `name`, `start_at` / `end_at` — **UTC ISO instants**; `timezone` — the event's IANA zone. Never date-split `start_at` in UTC: an 8 PM Toronto event is next-day UTC (this bug shipped once — see `northbound-failure-archaeology`)
- `geo_address_info` — `{city, country, country_code, full_address, address, sublocality, city_state}`; `mode: "obfuscated"` hides street addresses
- `cover_url` / `social_image_url` — image; `location_type` — `'offline'` else online (but some "offline" webinars put a registration URL in the address — `mapLumaEvent` forces those online via `venueIsUrl`)
- `url` — usually a bare slug (prefix `https://lu.ma/`), but externally-hosted events carry a **full URL** — never prefix unconditionally or links 404 as `https://lu.ma/https://…`
- `ticket_info` — `is_free`, and `price` is `{cents, currency}` (occasionally number/string) — `lumaPrice()` in `normalize.ts` handles all three; naive `String(price)` renders `[object Object]`
- List entries carry **no description** — `normalize.ts` synthesizes one (schema requires it)

**The vanity-slug trap (load-bearing):** Luma vanity slugs are squatted — `lu.ma/cohere` is a coliving community, NOT Cohere AI; `lu.ma/modal` is unrelated to Modal Labs. **Always pin `calendarApiId`** in `COMPANY_SOURCES` (Cohere = `cal-400NOkbFqzrkJNA`, `lib/fetchers/config.ts`). To vet a new calendar: resolve the slug via `/url?url=<slug>` and verify the calendar's display name belongs to the company before adding it. 27 of the 28 luma-provider entries pin `calendarApiId`; only Notion Toronto uses a slug (as of 2026-07-20).

## MLH — embedded JSON in season pages

`lib/fetchers/mlh.ts` fetches `MLH_SEASON_URLS` — **`https://www.mlh.com/seasons/2026/events`, `.../2027/events`** as of 2026-08-16 (moved off `mlh.io`, which now 302-redirects to `www.mlh.com`) — as plain HTML and extracts the event array with `extractJsonArray(text, '[{"id":"')`.

**Why balanced-bracket parsing, not regex:** the embedded array contains nested objects (`venueAddress`, arrays) and strings that may contain `[`/`]`/escapes. A lazy regex like `/\[.*?\]/` terminates at the first `]` inside a nested value; a greedy one overshoots into unrelated script content. `extractJsonArray` walks characters tracking bracket depth and string/escape state, returning the first *complete* array after the marker. Reuse this helper (or `ethglobal.ts`'s `extractArray` / `figma.ts`'s `extractJson`, same technique) for any new embedded-JSON source.

**Raw fields consumed:** `id`, `name`, `startsAt`/`endsAt` (UTC ISO), `status` (`'ended'` filtered), `formatType` (`'digital'`|`'physical'`), `venueAddress {city, state, country}`, `websiteUrl`, `backgroundUrl`/`logoUrl`, `dateRange`, `location`.

**Scoping — widened 2026-08-16 (ADR-019):** digital events are always kept (joinable from anywhere). In-person events are now kept for **ALL of the US** (`venueAddress.country === 'US'`, no state narrowing) — the travel-reimbursement/enrichment feature (ADR-018/020) is about flying to majors nationwide, so narrowing to a few US states would defeat the point. **Canada stays narrowed**: `venueAddress.country === 'CA'` and state ∈ `MLH_PROVINCES` (`ON/Ontario/QC/Quebec/Québec`) — unchanged from before. First run after the widening grew the hackathon lane by ~46 docs. A missing season page (pre-publication 404) is skipped with a warning, by design.

## Hackathon aggregate — Devpost, DoraHacks, ETHGlobal (+ Luma discover)

`lib/fetchers/hackathons.ts` fans out to four isolated providers (one failing can't sink the others). All emit `CompanyStdEvent` except the Luma slice, which tags raws `_provider:'luma'` + `_company` so `normalize.ts` reuses the verified Luma mapper. `normalize.ts` force-sets `category:'hackathon'` for the whole source.

**`MAX_HACKATHON_DAYS = 120`** (`config.ts`): Devpost/DoraHacks also list perpetual "marathon"/template challenges with multi-month-to-year windows; anything whose start→end span exceeds 120 days is dropped so the feed stays event-like (enforced in `devpost.ts` and `dorahacks.ts`).

| Provider | Endpoint | Scoping as implemented |
|---|---|---|
| Devpost (`devpost.ts`) | `https://devpost.com/api/hackathons?challenge_type[]=<online\|in-person>&status[]=open&status[]=upcoming&order_by=deadline&per_page=30&page=N` — **two slices** as of 2026-08-16 (ADR-019), `SLICES = ['online', 'in-person']` | Online: location-agnostic ⇒ always kept. In-person: `classifyRegion({city, venue, online:false})` — must classify **positively** to US/CA (free-text venue names default to `UNKNOWN`, which the generic gate KEEPS, not drops — precision-over-recall gate lives in the fetcher itself, not the generic geo gate). Both slices page until `meta.total_count` or `MAX_ITEMS` |
| DoraHacks (`dorahacks.ts`) | `https://dorahacks.io/api/hackathon/?status=<upcoming\|ongoing>&page=N` (undocumented Django REST) | `participation_form === 'Virtual'` only; skip null `uname` (URL would 404); ≤3 pages per status; ~1 req/s throttle |
| ETHGlobal (`ethglobal.ts`) | `GET https://ethglobal.com/events` with header `RSC: 1` → Flight payload, balanced-bracket slice of `"events":[` | `type==='hackathon'` + `status==='future'`, virtual or `city.countryCode` US/CA |
| Luma discover (`luma.ts` `fetchLumaHackathons`) | The `cat-ai`/`cat-tech` category endpoint above | `HACKATHON_NAME` regex on the name, upcoming, virtual (`location_type==='virtual'`) or `geo_address_info.country_code` US/CA |

**Per-provider shape notes:**
- Devpost: `submission_period_dates` is a **display string** ("Jun 14 - 21, 2026", "Dec 30, 2025 - Jan 5, 2026") parsed by `parseDevpostRange` (`companies/shared.ts`); unparseable → skip, never guess. `thumbnail_url` may be protocol-relative (`//…`). `displayed_location.icon === 'globe'` or `.location === 'Online'` ⇒ online. Blocks named AI-crawler UAs ⇒ `BROWSER_UA`. Deliberately passes **no** `_regions` hint for the online slice — `['Online']` would read as a non-NA hint and drop the event in the geo gate (comment in `devpost.ts`). **Application/deadline mapping (ADR-019, 2026-08-16):** `open_state` `'open'` or `'upcoming'` → `applicationStatus: 'open'` (registration is possible in both — the submission window opening later doesn't block *joining* now; this is a one-line call, revisit if it proves wrong), anything else → `'unknown'`; `submission_period_dates`'s parsed end → `applicationDeadline`. **In-person leak incident (live-verified 2026-08-16):** the generic scrape-level geo gate only drops positively-foreign (`INTL`) events and *keeps* `UNKNOWN` by design (I4 in `northbound-architecture-contract`) — relying on that alone let University of Sydney (an unresolvable free-text venue → `UNKNOWN`, not `INTL`) through on the first live run. Fix: `devpost.ts` itself now requires a **positive** `US`/`CA` classification for every in-person item (`geo.region !== 'US' && geo.region !== 'CA'` → skip) — precision over recall, deliberately stricter than the generic gate for this one fetcher. Don't "simplify" this back to trusting the generic gate.
- DoraHacks: `start_time`/`end_time` are **epoch seconds**. An AWS WAF returns **405 + an HTML challenge page** on bursts or missing `Accept` — the fetcher checks content-type and treats non-JSON as a failed page, never data. Keep the `sleep(1100)` throttle.
- ETHGlobal: banner URLs are **1-hour-presigned S3** — the adapter stores `image: ''` on purpose; persisting them guarantees dead images.

## Watchlist — curated named hackathons off their own sites (new 2026-08-16, ADR-019)

`lib/fetchers/watchlist.ts` polls each entry in `WATCHLIST` (`lib/data/watchlist.ts`) nightly
and emits a `CompanyStdEvent` once the site announces a future edition's dates — a wholly
separate source from `hackathon` (Devpost/DoraHacks/ETHGlobal/Luma), added because these
majors don't reliably appear in any of those aggregators.

**Seed list (10 entries as of 2026-08-16):** Cal Hacks, PennApps, BigRed//Hacks, SproutGT,
HackHarvard (tracked at `hhuh.io` — `hackharvard.io` 301s there), HackMIT, HooHacks, YHack,
TreeHacks, McHacks. Each entry: `{name, host, city, country, school, note?, knownNext?}` —
`host` is the stable canonical hostname (survives yearly URL churn), `knownNext` is a curated
fallback start/end date.

**The SPA-blank reality:** most of these official sites are JS-rendered SPAs whose raw HTML
body is near-empty — `hackmit.org`'s raw HTML is **14 characters of text** (verified
2026-08). `pageText()` therefore extracts `<title>` + all `<meta content>` values (often the
only server-side text) in addition to the stripped body, before regex date-extraction runs
over the concatenation.

**Date extraction:** `extractFutureRange()` matches month-name ranges ("October 16–18,
2026", "Sept 19 - 20, 2026") and single dates, bounded to ~13 months out to reject
countdown-timer noise, and only accepts a match whose start is `>= today` (future-only).

**`knownNext` fallback:** used only when page extraction finds nothing on an SPA-blank site;
still subject to the same future-date guard, so a past `knownNext` self-retires (stops being
used) rather than fabricating a stale edition.

**No next-year guessing for yearless date strings — the load-bearing rule.** A stale
`mchacks.ca` page still showing last edition's "January 17-18" (no year) fabricated a 2027
edition on the first live run when the extractor assumed "next occurrence." Fixed by removing
that assumption: yearless ranges are trusted **only in their current-year reading** — if that
reading is already in the past, the entry is simply skipped, not rolled forward a year. Do
not reintroduce a next-year inference for this fetcher.

MLH city strings get trailing commas stripped in the MLH mapper only (`lib/fetchers/mlh.ts`)
— a global `canonicalCity()` change would re-fingerprint every already-stored doc (e.g.
"Washington, D.C."), so this stays a source-local fix. Watchlist entries that also appear in
MLH's own listing (e.g. BigRed//Hacks) dedup naturally via the frozen fingerprint recipe
(title|date|city) — no special-casing needed.

## Enrichment stage — post-scrape hackathon signal fetch (new 2026-08-16, ADR-020)

Not a `FETCHERS` source — a **separate stage** that runs after the scrape job in the GitHub
Actions chain (ADR-023). `scripts/enrich-hackathons.mjs` fetches each in-person US/CA
hackathon's own site (+ one same-host FAQ link) and writes an `enrichment` subdocument that
the scrape pipeline can never overwrite (the field-ownership rule — ADR-018, invariant I11 in
`northbound-architecture-contract`). Operating it (cadence, dispatch input, CLI flags) belongs
to `northbound-run-and-operate`; this section is the domain knowledge — what it fetches, how
it classifies, and the traps found live.

**Selection:** every doc with `category:'hackathon'`, `mode != 'online'`, `region in [US,CA]`,
`date` within the next 183 days. Aggregator hosts (`devpost.com`, `mlh.io`, `mlh.com`,
`dorahacks.io`, `ethglobal.com`, `lu.ma`) are skipped — their application signal is already
API-owned or not worth scanning.

**Budgets and cadence:** the fetch unit is a **host**, not a doc — one fetch enriches every
selected event sharing that host. Per run: 25 hosts (`--budget N` / the `enrich_budget`
workflow-dispatch input overrides for backfills), ≤2 pages per host (landing page + one
same-host FAQ link found by scanning `<a>` text/href for "faq"), 10s fetch timeout, 1.5s
sleep between requests, no retries. **Staleness cadence** decides which stale hosts get
re-fetched first: 3 days if the event is <60 days out, else 7 days, with a 7-day backoff on
`fetch_failed`/`blocked` (don't hammer a host that's already failing).

**Classifiers (regex-based, evidence-snippet-producing):**
- **Application status** — precedence `closed` → `not_yet` → `open` (a deliberate "applications
  closed" statement beats a lingering "Apply now" CTA button still on the page). Deadline
  extraction looks for "apply/register … by/due/deadline … ⟨month day[, year]⟩" near the
  status phrase; a year-less deadline is resolved to whichever year keeps it `<=` the event's
  start date (a deadline precedes the event, never follows it).
- **Travel** has a **mention-gate**: if the page never mentions
  travel/reimbursement/stipend/bus/flight-credit at all, status is `'unknown'` — **silence
  never maps to `'no'`**, only an explicit negative statement does. Negative/positive patterns
  use **stemmed verbs**, not literal words — a literal `'provide'` match missed "we will not
  be **providing** any travel reimbursements" on a live `uofthacks.com` run; the regex now
  matches the stem (`provid\w*`).
- Every classifier result carries an **evidence snippet** (±120 chars around the match,
  capped at 280) so a human can sanity-check the classification without re-fetching the page.

**Curated overrides (`scripts/hackathon-overrides.json`, hostname-keyed):** carry **travel
policy only** — application status is time-varying (opens/closes every cycle) and would rot
if hardcoded. 7 hosts curated as of 2026-08-16 (HackMIT, TreeHacks, PennApps, HooHacks, YHack,
Cal Hacks, McHacks). An override wins over the site heuristic and stamps
`enrichment.source: 'curated'` instead of `'site'`.

**Write shape:** `enrichment: {host, checkedAt, source, fetchStatus, application:
{status, deadline?, evidence?}, travel: {status, amount?, evidence?}}`. Plus one courtesy
`$unset` (ADR-022): on a real open→closed transition for a doc that was already
`notifiedOpenAt`-stamped, the script clears that marker so a later re-open re-notifies the
digest.

**New trust surface:** the `MONGODB_URI` repo secret (the enrichment job connects to Atlas
directly, not via `/api/refresh`) — Atlas network access must allow GitHub-runner egress IPs.

## Company platforms — registry + adapters

ADR-010/ADR-013 model: a company is **pure config** in `COMPANY_SOURCES` (`lib/fetchers/config.ts`, 38 entries as of 2026-07-20) mapped to one of 11 provider adapters in the `PROVIDERS` map (`lib/fetchers/company.ts`). Adding a company on a supported platform is one config line; a new platform is one adapter file. `COMPANY_DIRECTORY` and `DEV_ONLY_COMPANIES` derive from the registry automatically. Note `config.ts` is imported by a client component (`CompanyDirectory.tsx`) — it must stay client-safe: no secrets, no `server-only`.

**Generic providers** (in `company.ts` itself):
- `luma` — any company Luma calendar via `fetchLumaEntries({slug?, calendarApiId?})`; 28 entries (pin `calendarApiId` — see the vanity-slug trap above)
- `tribe` — any WordPress site running "The Events Calendar": `GET {base}/wp-json/tribe/events/v1/events?per_page=50`; raw items carry `title`, `start_date`/`end_date` (**already local** `YYYY-MM-DD HH:MM:SS`), `venue {venue, slug, city}`, `image.url`, `cost`, `website`/`url`; titles may carry HTML entities (`&#8211;`) — `stripHtml` decodes. One entry: Vector Institute

**Bespoke adapters** (9 files in `lib/fetchers/companies/`, all emit `CompanyStdEvent`):

| Adapter | Mechanism | Key traps |
|---|---|---|
| `google.ts` | Scrape `developers.google.com/events?hl=en` gallery HTML between `id="upcoming-events"` and the directory table | Devsite **randomly machine-translates** (th/pt-BR/ko observed), destroying the h3-id slugs — `?hl=en` + `accept-language: en-US` pin it. Dates are free text, usually year-less → `inferYearDate` with Dec→Jan wrap |
| `aws.ts` | Official directory-search JSON `aws.amazon.com/api/dirs/items/search?item.directoryId=alias%23events-webinars-interactive-cards…` — robots.txt explicitly allows it | No server-side date filter: sorted date-desc, filtered `>= today` client-side, then **reversed** so the cap keeps soonest |
| `reactor.ts` | `developer.microsoft.com/reactor/api/events?page=N` — **no culture prefix** (`/en-us/…` 404s) | `startDateTimeUtc` is true UTC but there's no per-event IANA zone; `isSeries` entries skipped (sessions cover them); `regions[]` passed as `_regions` hints |
| `yc.ts` | Rails+Inertia `data-page` JSON on `events.ycombinator.com/<slug>`; slug discovery from `workatastartup.com/events` `props.eventsUpcoming` | **No public index** — discovery is usually empty; config MUST seed `slugs` (`['startup-school-2026']`) or the adapter yields 0 |
| `nvidia.ts` | Hand-edited AEM DAM JSON `nvidia.com/content/dam/en-zz/Solutions/about-nvidia/calendar/en-us.json` | Mixed date formats + literal `'TBC'` → `parseLooseUSDate`, skip unparseable; `regions` is messy free text → split/trim into `_regions` |
| `tesla.ts` | `tesla.com/{locale}/events/api/events?lat=&lng=&page=1&limit=` per centroid (Toronto, Montreal; ~120 km radius) | lat/lng **required** (412 without). `dates[].startDate` is **faux-UTC**: local calendar date encoded `T00:00:00+00:00` — only the date part is meaningful; real zone is `locations[0].timezone`, clock times only in the human `hours` string (`parseHours`). Akamai TLS-fingerprints curl → 403 |
| `databricks.ts` | Gatsby page-data JSON `databricks.com/en-website-assets/page-data/events/page-data.json` (~2.25 MB) | Cloudflare blocks curl's TLS; `eventsEN` still contains CJK-titled localized items (dropped) and one null `fieldDateTimeTimezone` (guarded); time-of-day is a CMS save artifact — date-only |
| `snowflake.ts` | Walk `__INITIAL_STATE__` on `/en/developers/events/` for the `location-based-event-search` component | The cleaner `filter.json` API matches a robots `Disallow` — **don't use it**. `eventDate` is year-less `'DD MON'` → `nextOccurrence` (not `inferYearDate` — feed is upcoming-only). Location typos exist ('Syndey') |
| `figma.ts` | Reassemble Next.js RSC flight chunks (`self.__next_f.push`), first `eventListLego` with an **inline** events array (later ones are `$`-refs) | One event per `times[]` entry; keyword filter (`DEV_RE`) keeps dev-facing sessions; throws loudly on zero extraction so layout changes are visible |

**The `CompanyStdEvent` contract** (`companies/shared.ts`): `_std: true`, `_provider`, `_company`, `title`, `url`, `online`, plus EITHER `startISO`/`endISO` + IANA `timezone` (instant-based sources) OR local `date`/`endDate`/`time`/`endTime` parts (date-only sources — mapper defaults time to `'09:00'` rather than inventing precision). Optional: `id` (auto-namespaced `${_provider}:${id}` as `sourceId`), `city`/`country`/`venue`, `mode` (overrides `online` for hybrid), `isFree`/`price`, `category`, `_regions` (audience hints for the geo gate). One mapper — `mapStdCompanyEvent` in `normalize.ts` — covers every adapter; adding a platform never touches the normalizer.

**Deliberately excluded platforms** (robots etiquette, reaffirmed in ADR-010 and ADR-013): GDG/Bevy (`gdg.community.dev`) and CNCF community — their APIs work unauthenticated but robots.txt disallows `/api/` for all agents. Apple/Meta/OpenAI/Anthropic: no public feed or empty Luma calendars under squatted vanity slugs. Do not "fix" these exclusions.

## Apify — the paid path (eventbrite, meetup)

**G1 applies in full: never schedule these; any actor run costs money and requires gordon's explicit approval FIRST.**

**The actor model:** an actor is a hosted scraper; starting one creates a *run*; a finished run's items land in its *default dataset*. The client (`lib/fetchers/apify.ts`) does: `POST /v2/acts/{actor~name}/runs?waitForFinish=60&timeout=…[&maxItems=…][&memory=…]` → poll `GET /v2/actor-runs/{runId}?waitForFinish=60` until terminal (`SUCCEEDED|FAILED|ABORTED|TIMED-OUT`) → `GET /v2/datasets/{defaultDatasetId}/items?clean=true&format=json`. Token goes in `Authorization: Bearer` only — never `?token=` (leaks into logs). For manual inspection, `GET /v2/acts/{actorId}/runs/last` fetches the most recent run without knowing its id (documented in `.claude/docs/gotchas.md`; the app client itself polls by run id).

**The billing lesson (the reason G1 exists):** an actor's `maxItems` INPUT field is **advisory** — the meetup actor ignored it; a run that requested 20 items billed ~10× the request (~$1.4–2; the canonical dual account of the cost figures is `northbound-failure-archaeology` A4), exhausting most of the ~$5/mo free credit. The binding caps are **run options**: `?maxItems=` (hard billing cap on dataset items), `?memory=` (pay-per-event start fees charge PER GB — this actor defaults to 4 GB), and server-side `?timeout=` (set to poll deadline + 30 s so an abandoned client poll can't leave a run billing). `runActor` always sets these — never bypass it with raw actor calls.

| Actor | Input as implemented | Run options |
|---|---|---|
| `parseforge/eventbrite-scraper` | `{city: 'canada--<city>', category: 'science-and-tech', maxItems}` — slug format is `country--city` (`canada--toronto`, `canada--mississauga`, `canada--ottawa`, `canada--montreal`), NOT `toronto--ontario`. One run per city | `maxItems = max(5, ⌊MAX_ITEMS/4⌋)`, `memory=1024` |
| `easyapi/meetup-events-scraper` | `{searchUrls: MEETUP_SEARCH_URLS, maxItems}` — ONE batched run (flat ~$0.09 start fee per run) over 4 URLs: keyword `tech` × locations `ca--on--Toronto`, `ca--on--Ottawa`, `ca--qc--Montréal`, `ca--qc--Québec`. Actor crawls ~1 min/URL — keep the list ~4 | `maxItems = MAX_ITEMS`, `memory=2048` (peak observed ~1.3 GB), `timeout≈310s` (from `timeoutMs: 280_000`) |

**Raw shapes consumed** (`database/normalize.ts` `mapRaw`):
- Eventbrite: `id`, `title`, `summary`, `tags[]`, `description` (HTML), `startDate`/`startTime`/`endDate`/`endTime` — **already local**, store as-is — `timezone`, `isOnline` (the venue strings also say "Online"; trust the boolean), `venue {city, fullAddress, name, country}` (country lowercase `ca`), `organizer.name`, `images.medium`/`imageUrl`, `pricing {isFree, priceDisplay}` (`isFree:false` with null prices = unknown-paid, don't infer free), `url`, `format`.
- Meetup: `id`, `title`, `description`, `dateTime` (ISO **with offset**), `eventType` (`PHYSICAL|ONLINE`), `venue {city, address, name, country}`, `group {name, timezone}`, `feeSettings` (`null` ⇒ free), `eventUrl`, `featuredEventPhoto.highResUrl`/`displayPhoto.highResUrl`.

**Status caveat:** the meetup path has **never completed a live end-to-end run** — credit ran out mid-validation 2026-06 and, as of 2026-07-19, the live DB holds 0 meetup docs (eventbrite: 29, aging out). Its item shape was verified from partial runs; treat the meetup mapper as plausible-but-unproven. History in `northbound-failure-archaeology`.

## Cross-cutting: HTTP & anti-bot reality

Default identity is `NorthboundBot/1.0 (+https://github.com/CodeOfGordon)` via `getJSON`/`getText` (`lib/fetchers/util.ts`) — used by Luma, MLH, the tribe provider, and Reactor. Everything else needs `BROWSER_UA` (Chrome 130 Linux string, `companies/shared.ts`):

| Blocker class | Affected | Reality |
|---|---|---|
| TLS-fingerprinting CDN (Akamai/Cloudflare) | Tesla, Databricks | **403 every curl request regardless of headers.** Node's native fetch with a browser-ish UA passes — exactly the production runtime. Smoke-test with `npx tsx`, never curl; a curl 403 proves nothing |
| robots.txt AI-crawler UA blocks | NVIDIA, Figma (also Devpost blocks named AI UAs) | Blanket-block tokens like `anthropic-ai`, `GPTBot` — adapters send `BROWSER_UA` |
| Random machine translation | Google devsite | Serves th/pt-BR/ko variants on back-to-back requests, translating away the h3 ids — pinned with `?hl=en` + `accept-language: en-US` |
| WAF rate challenge | DoraHacks | 405 + HTML challenge on bursts/missing Accept — content-type check + ~1 req/s throttle |
| robots.txt path disallow (honored) | GDG/Bevy, CNCF (`/api/`), Snowflake `filter.json` | Working endpoints deliberately not used — etiquette lines this project does not cross |

## Cross-cutting: date & timezone theory as applied

- **Storage model:** `date` and `time` are strings (`YYYY-MM-DD`, `HH:MM` 24 h). Downstream comparison is **lexical** — for `YYYY-MM-DD`, lexical order === chronological order, which is why all range filters are plain string compares. Never store a locale/ambiguous date format.
- **Wall-clock extraction:** UTC instants (Luma `start_at`, MLH `startsAt`, DoraHacks epochs, Reactor, Figma, YC) are converted with `partsInZone` (`database/normalize.ts`): `Intl.DateTimeFormat('en-CA', {timeZone, hourCycle:'h23'})` reads the wall-clock parts **in the event's IANA zone**, default `America/Toronto`. Splitting an ISO instant on `'T'` shifted evening Toronto events to the next day — the founding bug of this convention.
- **Date-only strings** ("June 15, 2026") are parsed as local midnight and read back with **local getters** — pushing them through a zone conversion is what shifts the day.
- **Faux-UTC:** Tesla's `dates[].startDate` looks like a UTC instant (`T00:00:00+00:00`) but encodes a **local calendar date** — only the date part means anything. Suspect this pattern in any feed where all timestamps are exactly midnight UTC.
- **Year-less dates:** Google ("June 9-10") uses `inferYearDate` (anchor to today, Dec→Jan wrap at ~6 months look-back); Snowflake ("DD MON", upcoming-only feed) uses next-occurrence resolution instead — the look-back heuristic would mis-anchor there.
- Sources whose parts are already local (Eventbrite, tribe, Tesla-after-decoding, AWS, NVIDIA) are stored as-is — no conversion.

## Cross-cutting: geo classification

`lib/fetchers/geo.ts` `classifyRegion` distills free-text locations into `region: 'CA'|'US'|'ONLINE'|'INTL'|'UNKNOWN'`; `normalize.ts` collapses anything not North-America-attendable to `'INTL'`, and `lib/scrape.ts` drops `INTL` pre-upsert (ADR-015).

- **Precedence:** online signal → explicit country in the text → US state (code or name, any comma segment) → Canadian province → curated city lookup (first comma segment, then last-segment fallback) → `_regions` hints / TBA.
- **`INTL` means "positively classified outside Canada/US"** — it is the only dropped bucket. `ONLINE` and `UNKNOWN` are kept (`isNorthAmerica` defaults true: joinable from anywhere / not confirmed foreign), UNLESS `_regions` hints exclude North America (e.g. an "APAC" webinar) — then they collapse to INTL too.
- The authoritative signal is the **city string** — company adapters rarely capture a reliable country (most were 'TBA' pre-ADR-015). Don't filter on raw `country`.
- Curated rules: bare `London` = UK (INTL); only `London, ON`/`London, Ontario` is Canadian. Mexico is INTL by product decision despite being geographically NA. Unknown city typos ('Syndey') fall through as UNKNOWN and are kept — accepted, don't chase typos.
- City canonicalization happens separately in `normalize.ts` (`CITY_ALIASES`: `Montréal`→`Montreal`, `Québec`/`Quebec`→`Quebec City`) — this feeds both the city filter and the fingerprint.

## Cross-cutting: dedup theory as applied

`buildFingerprint` (`database/fingerprint.ts`) = `sha256( lower(trim(title)) + '|' + date + '|' + lower(trim(city)) )` — **exact-hash blocking** on normalized values (title already `cleanTitle`d and sliced to 100 chars; city canonicalized). Upserts key on `{fingerprint}` (unique+sparse index); a cross-source E11000 race is a benign dedup outcome.

Design choices and why:
- **Time excluded:** sources disagree by minutes for the same event; including time would split obvious duplicates.
- **City included:** the same title+date legitimately recurs across cities (multi-city event series must NOT merge).

**Known miss classes** (exact-hash blocking cannot catch these — accepted, not bugs):
- *Title drift:* the same event phrased differently per platform ("AI Tinkerers Toronto — July" vs "AI Tinkerers Toronto Meetup") hashes apart.
- *City variants outside `CITY_ALIASES`:* only Montréal/Québec spellings are canonicalized; e.g. one source saying `Online` while another names the physical city also splits.
- *Date disagreement:* multi-day events where sources report different start dates.
- *Series identity:* each occurrence is deliberately a separate event (slug embeds the date for this reason — see `northbound-pipeline-engineering`), so there is no cross-occurrence entity.

Proper entity resolution (fuzzy blocking, canonical event identity across sources) is an **open frontier** — tracked with falsifiable milestones in `northbound-research-frontier`. Do not bolt fuzzy matching onto the fingerprint without going through that skill's evidence bar.

## When NOT to use this skill

- **Changing** a fetcher, adding a company/platform/hackathon provider, touching normalization, schema, or dedup code → `northbound-pipeline-engineering` (step-by-step change checklists live there, not here).
- Triaging a failing scrape or empty lane right now → `northbound-debugging-playbook`.
- The full history of source incidents (billing runaway, UTC day-shift, INTL flood…) → `northbound-failure-archaeology`.
- Actually running scrapes, the cron, deploys, or the paid-source approval protocol → `northbound-run-and-operate`.
- Measuring per-source health/coverage with the shipped scripts → `northbound-diagnostics-and-tooling`.
- Reviving Eventbrite/Meetup coverage or the local-coverage-decay problem → `northbound-coverage-campaign`.
- Entity resolution / smarter dedup research → `northbound-research-frontier` + `northbound-research-methodology`.
- Environment setup, env vars → `northbound-build-and-env`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit 63a965a + verified commands; endpoint/shape claims re-verified line-by-line against `lib/fetchers/**` and `database/normalize.ts`. Live-DB numbers (473 events; meetup 0 / eventbrite 29 docs) were measured 2026-07-19 via the read-only MongoDB MCP and not re-measured. External endpoints were live-verified by the project 2026-06-10/11 (per fetcher header comments), not re-fetched for this document — platform-side drift is always possible.

| Volatile fact | Re-verify with |
|---|---|
| 7 sources in the registry (incl. `watchlist`, added 2026-08-16) | `grep -n "FETCHERS" lib/scrape.ts` and read the map at `lib/scrape.ts` |
| Luma endpoints + city slugs | `grep -n "api.lu.ma\|LUMA_CITY_SLUGS" lib/fetchers/luma.ts lib/fetchers/config.ts` |
| Luma hackathon categories `cat-ai`/`cat-tech` | `grep -n "LUMA_HACKATHON_CATEGORIES" lib/fetchers/config.ts` |
| 38 company entries / 28 luma-provider entries | `grep -c "company: '" lib/fetchers/config.ts` (38) and `grep -c "provider: 'luma'" lib/fetchers/config.ts` (29 = 28 entries + 1 type-union line) |
| 11 providers (2 generic + 9 bespoke) | `grep -n "PROVIDERS" lib/fetchers/company.ts` and `ls lib/fetchers/companies/` (10 files incl. shared.ts) |
| MLH season URLs now on `www.mlh.com`, US in-person unnarrowed, CA still ON/QC | `grep -n "MLH_" lib/fetchers/config.ts` |
| Devpost two slices (`online`,`in-person`) + `applicationStatus`/`applicationDeadline` mapping | `grep -n "SLICES\|applicationStatus\|applicationDeadline" lib/fetchers/devpost.ts` |
| Watchlist seed list (10 entries) + `knownNext` fallbacks | `grep -c "name:" lib/data/watchlist.ts` |
| Enrichment script budgets/cadence (25 hosts, 3d/7d staleness, 7d backoff) | `grep -n "BUDGET\|HORIZON_DAYS\|isStale" scripts/enrich-hackathons.mjs` |
| `MAX_HACKATHON_DAYS = 120` | `grep -rn "MAX_HACKATHON_DAYS" lib/fetchers/` |
| Apify actor ids | `grep -n "ACTOR" lib/fetchers/eventbrite.ts lib/fetchers/meetup.ts` |
| Run-option caps (`?maxItems=`/`?memory=`/`?timeout=`) still set | `grep -n "maxItems\|memory\|timeout" lib/fetchers/apify.ts` |
| Eventbrite city slugs / category | `grep -n "EVENTBRITE" lib/fetchers/config.ts` |
| Which fetchers use `BROWSER_UA` | `grep -rl "BROWSER_UA" lib/fetchers --include="*.ts"` |
| Cohere pinned calendar id | `grep -n "cal-400NOkbFqzrkJNA" lib/fetchers/config.ts` |
| Meetup still never live-verified / doc counts | MongoDB MCP (read-only): `count` on collection `events` in db `test` with `{source:'meetup'}` — 0 as of 2026-07-19 |
| GDG/Bevy + Snowflake robots exclusions still current | `curl -s https://gdg.community.dev/robots.txt \| grep -i disallow` (and same for `www.snowflake.com`) |
| Fingerprint recipe | `grep -n "sha256\|title\|date\|city" database/fingerprint.ts` |
| Geo region buckets + INTL gate | `grep -n "type Region" lib/fetchers/geo.ts && grep -n "INTL" lib/scrape.ts` |
