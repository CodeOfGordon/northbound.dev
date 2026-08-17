---
name: northbound-frontend-engineering
description: Runbook for UI and web-surface work on Northbound (Next.js 16 App Router event aggregator) — pages, the /events URL filter-state contract, lanes, scroll-perf conventions (weserv image proxy, solid .glass header, Lenis), design-token compliance under PRODUCT.md/DESIGN.md, calendar export, PostHog event names, and the as-built API routes. Load for any change to app/, components/, lib/events.ts, globals.css, or when debugging filters, images, scroll jank, analytics, or JSON-LD.
---

# Northbound frontend engineering

Runbook for the web surface of Northbound: 3 pages, ~20 components, one server-only data
layer. Replaces the legacy `frontend`, `calendar-button`, and `backend-api` skills, which
were written pre-implementation and prescribe things that never shipped (SWR was never
installed; client state is URL searchParams + server components). Everything below is
verified against code as of 2026-07-20.

**Hard gate G3 applies to all UI work:** `PRODUCT.md` and `DESIGN.md` at repo root are law
— token system, anti-references, WCAG 2.2 AA floor, scroll-perf conventions. Deviations
need gordon's sign-off first (see `northbound-change-control`).

## Non-negotiables

| Rule | Source of truth |
| --- | --- |
| Pages read Mongo via `lib/events.ts` (`import 'server-only'`) — NEVER fetch `/api/events` from a page or component (ADR-012, `.claude/docs/decisions.md`) | `lib/events.ts` header comment |
| No SWR, no react-query, no client-side data fetching. Filter state lives in the URL | `package.json` (neither installed) |
| Image fades are DOM-only opacity mutations — never React state | `components/EventImage.tsx` |
| No `backdrop-filter` on sticky/fixed elements; `.glass` stays solid | `app/globals.css` `@utility glass` |
| No `content-visibility` utilities on feed items (they fight Lenis's rAF) | commit `6a886a4` |
| PostHog event names are a frozen analytics contract — renames need gordon | see PostHog section |
| Do not extend `/api/*` routes without direction via change control | see API section |
| Dark-only. No light mode, no `.dark` toggle | `DESIGN.md` Theme |

## Page inventory and data flow

All pages are **server components**. `/` and `/events` export
`const dynamic = 'force-dynamic'` (live DB reads, never prerendered); `/events/[slug]`
omits the export but is dynamic by param. `params`/`searchParams` are **Promises** in
Next 16 — `await` them at the top (done in every page and `generateMetadata`).

| Route | File | Renders | Data calls |
| --- | --- | --- | --- |
| `/` | `app/page.tsx` | Hero + 5 sections: company carousel, hackathons, Canada city rails, US rail, online grid | `getHomeSections()`, `queryEvents({limit:1})` (total), `getScrapeStatus()` (freshness) |
| `/events` | `app/events/page.tsx` | Lane tabs + FilterBar + SearchBox; date-grouped `EventTimeline` of `EventRow`; flat relevance-sorted row list when `q=`; `Pagination` | `queryEvents(...)`, `distinctCities(region)`, `upcomingCompanies()` |
| `/events/[slug]` | `app/events/[slug]/page.tsx` | schema.org Event JSON-LD, hero image (`w=1280 fill={false}`), about/agenda/tags, sticky aside with `RegisterButton` + `AddToCalendar`, related events | `getEventBySlug(slug)`, `getRelatedEvents(event)` (limit 3: same city or overlapping non-`tech` tags, upcoming) |

Also: `app/events/loading.tsx` (skeleton), `app/manifest.ts` (PWA), `app/layout.tsx`
(fonts, metadata, `<SmoothScroll/> <Backdrop/> <Navbar/> <main> <Footer/>`).

**Serialization boundary:** `toDoc()` in `lib/events.ts` projects lean Mongo docs into the
plain `EventDoc` interface — it strips `_id`, `fingerprint`, `sourceId`, `__v` and
defaults `timezone: 'America/Toronto'`, `tags: []`, `source: 'company'`. Every page-bound
query goes through it, so client components can take `EventDoc` props safely. Never pass a
raw lean doc to a client component.

**Formatting helpers (`lib/format.ts`) — components must use these, never raw fields.**
Rendering venue/city/country/price directly off an `EventDoc` produces "TBA, undefined"
and `[object Object]`-class bugs; the shared helpers absorb that:

- `formatVenue(venue, mode)` — detail-aside venue line; `null` means unknown (caller
  renders a muted fallback), `'Online'` for online events.
- `formatLocation({city, country})` — "City, Country" with unknown halves dropped.
- `formatCityLabel(e)` — card/row pin label; always renders something (falls back to
  `region` → "Canada"/"United States" → `formatLocation` → "Location TBA").
- `eventFlag(e)` — 🇨🇦/🇺🇸/🌐 keyed off the persisted `region` field (country-name fallback
  for region-less docs); replaces the old static `COUNTRY_FLAG` map (removed, see the
  dead-code list below).
- `formatPrice(isFree, price)` — `{label, kind: 'free'|'paid'|'unknown'}`; `'unknown'`
  renders as nothing on cards, "Price not listed" on detail — never asserts a price that
  isn't there.

**Home section shapes** (`getHomeSections()` in `lib/events.ts`):

- `company`: `diverseCompanyEvents(12)` — aggregation `$match {source:'company', date>=today}` → `$sort {date,_id}` → `$group` by `organizer` taking `$first` → `$replaceRoot` → re-sort → `$limit`. **One event per organizer**: this stops multi-city same-day series (Microsoft's "Build //localhost" ran 19 near-identical city editions) from flooding the hero rail. Depth per company is reachable via organizer chips and "View all". If the hero looks like one company took over, this aggregation is the first place to look.
- `companies`: `upcomingCompanies()` — organizer counts, busiest first; drives home chips (top 10) and `CompanyDirectory` counts.
- `hackathons`: `queryEvents({category:'hackathon', limit:10})` — includeOngoing kicks in (below).
- `canada`: per-city rails for `CANADA_CITIES = ['Toronto','Ottawa','Montreal']`, `limit:9`, **all sources** (local company events appear here too); empty cities filtered out.
- `unitedStates`: `queryEvents({source:'company', region:'us', limit:9})`.
- `online`: `queryEvents({region:'online', limit:9})`.

**Freshness UI:** `getScrapeStatus()` (`lib/meta.ts`) never throws (build-safety for
`/_not-found`, commit `2b8c7b9`). `FreshnessBadge` dims its pulsing mint dot to amber when
`lastRunAt` is >2 days old; `variant="bare"` on the hero, default `pill` in `Footer.tsx`.

**Hackathon signal helpers (`lib/hackathon.ts`, ADR-018):** `applicationSignal(event)` and
`travelSignal(event)` are the **only merge point** components use for the two hackathon
data sources — the scrape-owned `applicationStatus`/`applicationDeadline` fields and the
enrichment-script-owned `enrichment` subdoc. Never read `event.enrichment` or
`event.applicationStatus` directly in a component; call these instead so both fields
resolve through one place. Used by `EventCard.tsx`, `EventRow.tsx` (application only), and
the detail page (`app/events/[slug]/page.tsx`) for the "Apps open/closed/soon" and
"Travel aid" badges — both reuse the existing `.chip` / Free-badge treatment, no new
tokens.

## The /events URL filter-state contract

`app/events/page.tsx` reads exactly these params (arrays unwrapped via `first()`), passes
them to `queryEvents()` in `lib/events.ts`. Semantics as implemented:

| Param | Semantics in `queryEvents` (as of 2026-07-20) |
| --- | --- |
| `q` | `$text` search (title/description/tags index), relevance-sorted via `textScore`. **Forces includeOngoing off** — MongoDB forbids `$or` alongside `$text` |
| `city` | Anchored case-insensitive exact regex (`^...$`, escaped) |
| `mode` | Validated against `['online','offline','hybrid']`; silently ignored otherwise |
| `category` | Validated against `['hackathon','meetup','conference','networking']` |
| `source` | `'local'` → `$in ['luma','eventbrite','meetup']` (the Local lane collapse — platform doesn't matter to a browser). Otherwise validated against all 6 sources **including `'hackathon'`** |
| `organizer` | Anchored case-insensitive exact regex — powers company chips/directory |
| `region` | `canada`→`CA`, `us`→`US`, `online`→`ONLINE` (persisted `region` field) |
| `price` | `free`→`isFree:true`, `paid`→`isFree:false` |
| `from` | **Defaults to `todayInToronto()`** (Intl en-CA, America/Toronto) — feed is upcoming-only by default. YYYY-MM-DD compares lexically === chronologically |
| `to` | Optional `$lte` upper bound |
| `tag` | Single exact array-element match |
| `page` | ≥1; limit clamped 1–60, default 18 |

**includeOngoing** (hackathon long submission windows):
`includeOngoing = !q && (params.includeOngoing ?? params.category === 'hackathon')`. When
on, the date scope becomes `$or [{date >= from}, {endDate >= from}]` (wrapped in `$and`
with `{date <= to}` if `to` set), and sorting runs through an aggregation computing
`_eff = max(date, from)` so a still-running event sorts as "today", not at the top with a
stale start date. `EventTimeline`'s internal `group()` mirrors this client-side by clamping
`ev.date < today` into the current bucket.

**Hackathon lane defaults + `EventTimeline` granularity** (ADR-018, 2026-08-16): the
hackathon lane (`/events?category=hackathon`, no explicit `from`/`to`) now defaults to a
**6-month forward horizon**, `includeOngoing` forced **off** there specifically (dozens of
already-started online challenges were clamping into "today" and burying the planning
view — see `app/events/page.tsx` comment at `horizonDefault`). `EventTimeline` gained a
`granularity?: 'day' | 'month'` prop (default `'day'`); the hackathon lane passes
`'month'` so 180 one-row day groups collapse into month buckets. New date presets
`quarter` (+92d) and `half` (+183d) in `DATE_PRESETS` (`lib/constants.ts`) back the "Next 3
months"/"Next 6 months" picker options.

**Push semantics** (client components; both `'use client'` + `useRouter`):

- `FilterBar.apply(updates)`: rebuilds `URLSearchParams` from the current URL, sets non-empty values, deletes empty ones, **always deletes `page`**, captures `filter_applied`, then `router.push`. Chips are derived from the URL; each carries its own clear map (the region chip also clears `city`; the date chip clears both `from` and `to`).
- `FilterBar.clearAll()`: preserves only the lane (`?source=` or `?category=`), drops everything else, captures `filter_applied {cleared:true}`.
- `SearchBox.submit`: sets/deletes `q`, deletes `page`, captures `search_performed {q}` (only when non-empty).
- `Pagination` (server component) rebuilds links from a flattened param map, omitting `page` for page 1.

**Lane-dependent controls** in the FilterBar popover: Region always; Company (organizer)
select only in the company lane; City hidden in company AND hackathon lanes; Type
(category) and Price only in all/local; Format (mode) and When (date presets) always.

**Known quirk — `currentPreset` day-span inference** (`components/FilterBar.tsx`): any
`from`+`to` pair is labeled by day span (0→"Today", ≤7→"This week", else "This month"). A
hand-crafted `?from=&to=` 3-day range is mislabeled "This week" and its chip clears both
dates. Presets themselves are anchored to Toronto-local today (UTC anchoring rolled the
day early in the evening — fixed; see comment at `presetRange`). Open, low-priority.

## Lanes — consolidated into `lib/constants.ts` (2026-08-16)

A **lane** is the UX bucket (`company` / `hackathon` / `local`) derived from
`source` + `category`. Rule: `source === 'company'` → company;
`source in ('mlh','hackathon','watchlist') || category === 'hackathon'` → hackathon; else
local.

The derivation and the accent map used to be triplicated/duplicated across five files (W7
in `northbound-architecture-contract`) — **fixed 2026-08-16**. `lib/constants.ts` now owns
both single sources of truth:

| Export | `lib/constants.ts` | Consumers |
| --- | --- | --- |
| `laneOf(source, category)` | canonical lane derivation | `EventCard`, `EventRow`, detail-page chips |
| `laneFromParams(source, category)` | same derivation, `string \| null` params (URL-search-param shape) | `app/events/page.tsx`, `components/FilterBar.tsx` |
| `LANE_ACCENT` | dot/hover/text class map | `EventCard.tsx`, `EventRow.tsx` (both import the shared export — no local copies remain) |

The local copies previously in `app/events/page.tsx` (`laneFrom()`), `components/FilterBar.tsx`
(inline ternary), `components/EventCard.tsx`, and `components/EventRow.tsx` (independent
`LANE_ACCENT` maps) are gone — grep confirms `laneFromParams` and `LANE_ACCENT` now resolve
to single definitions imported everywhere. The "sensible candidate refactor" this section used
to flag as **not done** is done; any future lane change now only needs `lib/constants.ts`.

Adjacent surfaces that also encode the lane taxonomy (still worth checking on a lane change,
though these are taxonomy metadata, not derivation logic): `LANE_TABS`/`LANE_META` in
`app/events/page.tsx` (tab hrefs `/events?source=company`, `?category=hackathon`,
`?source=local`), `LINKS` in `components/Navbar.tsx` (same hrefs), `LANE_LABELS` +
`SOURCE_LABELS` in `lib/constants.ts`, and `LOCAL_SOURCES` in `lib/events.ts`.

Accent semantics are design law (G3): company = **amber** dot + amber hover border,
hackathon = **mint**, local = `light-200`. Accent is a 1.5px dot + hover border tint —
never a colored side-stripe.

## Scroll-perf conventions (law under G3)

Born of the jank saga (commits `ded4973` → `0b21f84` → `6a886a4` → `40b8c19` → `63a965a`;
full chronicle in `northbound-failure-archaeology`). These are settled conventions, not
suggestions:

**1. Scraped images go through the weserv resize proxy** (`components/EventImage.tsx`):

- Proxy URL: `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=${w}&output=webp&q=72&we` — applied only to `http(s)` srcs. Width-capped WebP cuts decode/paint cost ~10x. Plain `<img>`, not `next/image` (can't enumerate unknown scraped CDNs).
- Widths: default `w=640` (cards), `w=240` (`EventRow` thumbs), `w=1280` (detail hero, `fill={false}`).
- Fallback chain via `stage` state: `'proxy'` → onError → `'original'` → onError → `'failed'` (gradient placeholder + `CalendarRange` icon). `key={stage}` remounts the `<img>` per stage. State changes **only** on error.
- **The fade is DOM-only**: `style={{opacity: 0}}`, `onLoad` sets `e.currentTarget.style.opacity = '1'`; a ref callback sets it immediately when `node.complete` (cached). NEVER convert this to React state — a screenful of loads cascading re-renders during scroll was the stutter fixed in `40b8c19`. `loading="lazy" decoding="async"`, `transition-opacity duration-500` with `motion-reduce:transition-none`.

**2. No backdrop-filter on sticky/fixed elements.** `.glass` is a Tailwind `@utility` in
`app/globals.css`: `border-b border-border-dark bg-[#0a0b0d]/90` — a SOLID
nearly-opaque bar. Blur was removed in `63a965a` because a `backdrop-filter` on a sticky
element re-blurs everything scrolling under it every frame. The header gets it via the
element selector `header { @apply glass sticky top-0 z-50 }` in `@layer components`
(that's why `components/Navbar.tsx` has almost no classes on `<header>`/`<nav>`).

**3. No content-visibility utilities on feed items.** `cv-card`/`cv-row` exist in
`globals.css` but are applied nowhere — the render/unrender churn fights Lenis's rAF loop
(removed in `6a886a4`). Do not wire them back up.

**4. Lenis smooth scroll** (`components/SmoothScroll.tsx`, mounted in the root layout):

- Skipped entirely under `prefers-reduced-motion: reduce` (native scroll).
- `new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 })` driven by a manual `requestAnimationFrame` loop; full cleanup on unmount.
- A document-level click handler intercepts `a[href^="#"]` and routes through `lenis.scrollTo(target, { offset: -96 })` — the sticky-header offset. In-page anchors (e.g. hero `#events`) must remain plain `<a>` for this to work.
- The `.lenis` companion styles block in `globals.css` (`html.lenis`, `.lenis-smooth`, `[data-lenis-prevent]`, `.lenis-stopped`) is **required** by Lenis — don't prune it as "unused".
- Note: the comment in `SmoothScroll.tsx` claiming "scroll-driven reveal animations keep working" is stale — reveals were removed in `6a886a4`.

**5. The fixed page backdrop is static** (`components/Backdrop.tsx`): radial mint glow
(`rgba(89,222,202,0.14)`) + 56px masked grid, `fixed z-[-1]`, no JS/canvas/WebGL/filter
blur. It replaced the animated ogl LightRays (removed for scroll perf; `ogl` lingers
unused in `package.json`). Do not reintroduce animated/blurred backdrops.

## Design compliance under G3

`PRODUCT.md` (goals, anti-references, a11y floor) and `DESIGN.md` (token system captured
from the live implementation) are law. Quick reference — full detail in those files;
tokens live in `app/globals.css` `:root`, exposed to Tailwind v4 via `@theme inline`:

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `#0a0b0d` | Page bg, themeColor, header tint @90% |
| `--color-dark-100` | `#121419` | Card/panel surface |
| `--color-dark-200` | `#1e222b` | Raised surface, hover |
| `--color-dark-300` | `#2a2f3a` | Raised-2 |
| `--popover` | `#14171d` | Filter popover |
| `--color-border-dark` | `#1c2028` | Hairline borders |
| `--foreground` | `#f4f5f6` | Headings/primary on bg |
| `--color-light-100` | `#e4e6ea` | Body text on cards |
| `--color-light-200` | `#888f9d` | Muted/meta text |
| `--color-primary` (mint) | `#59deca` | Brand: CTAs, hackathon lane, focus ring, "Free", active filters. Ink on mint fills is `--primary-foreground #04110e` |
| `--color-amber` | `#fcd34d` | **RESERVED: company lane / official-event accent** (also the stale-freshness dot). Do not use elsewhere |
| `--color-blue` | `#8fd9ff` | Secondary accent, sparse |
| `--radius` | `0.75rem` | Cards `rounded-xl`; pills/chips full |

**Fonts** (via `next/font/google`, `display: swap`, in `app/layout.tsx`): Schibsted
Grotesk (`--font-schibsted-grotesk`) for display/UI/headings; Martian Mono
(`--font-martian-mono`) for meta — dates, counts, card day badges, and the `.label`
micro-label (mono 10px uppercase `tracking-[0.12em]` light-200).

**Utility/component classes** (all in `globals.css`): `.chip` (small tag), `.pill`
(interactive pill), `.seg`/`.seg-active` (lane segmented control), `.field` (selects, mint
focus ring), `.glass` (solid sticky-header surface), `.card-shadow` (one inset highlight +
soft drop — never stack shadows), `.label`, `.subheading`, `.flex-center`,
`.no-scrollbar` (home rails), `.text-gradient` (**confined to the single hero h1**).

**Anti-patterns** (from `PRODUCT.md` anti-references + `DESIGN.md`): no Eventbrite/Meetup
listing clutter; no SaaS-dashboard chrome/KPI cards/sidebars; no AI-slop landing
scaffolding (gradient-mesh heroes, per-section eyebrow kickers, numbered `01/02/03`
sections, decorative glassmorphism); no cutesy over-rounded consumer-app styling; no
side-stripe lane accents; no nested cards; no bounce easing.

**Accessibility:** WCAG 2.2 AA is the floor (≥4.5:1 body text, ≥3:1 large text/UI,
keyboard operability, visible focus, reduced-motion alternative for every animation — the
floor is not a ceiling on creativity; solve for both). Contrast watchpoint, **measured
2026-07-20**: solid `light-200 #888f9d` PASSES on all shipped surfaces — 6.06 on
`#0a0b0d`, 5.67 on `dark-100`, 4.90 on `dark-200` (thin margin: don't lighten `dark-200`
or darken `light-200`). The opacity-modified `light-200` body-text failures previously
flagged here — Footer `text-light-200/80` (4.23) and SearchBox placeholder `/60` (2.82) —
are **fixed 2026-08-16**: both now render solid `light-200` and pass. Also fixed the same
day: two raw-color tokens that bypassed the semantic-token system — `RegisterButton.tsx`
`text-black` → `text-primary-foreground`, `EventCard.tsx` `text-white` → `text-foreground`
(both on mint/foreground fills, so the visual result is unchanged, but they now track the
token if it ever moves). Numbers table in `northbound-validation-and-qa` §4, computation
recipe in `northbound-proof-and-analysis-toolkit` Recipe 7.

**Dark-only:** `globals.css`'s vestigial `@custom-variant dark (&:is(.dark *))` shadcn
scaffolding has been **removed 2026-08-16** (no `.dark` toggle ever existed to key off it).
Don't build `dark:` variants; don't add a light mode without change control.

**Lint baseline:** `npm run lint` is **0 errors / ~135 warnings** as of 2026-08-16. The
purity-baseline lint error previously logged against `FreshnessBadge.tsx` is fixed: it now
imports `olderThanDays()` from `lib/format.ts` like every other freshness check, instead of
computing staleness inline. Remaining warnings are pre-existing `@typescript-eslint` noise in
`.claude/skills/**` helper scripts, not app code — see `northbound-build-and-env` for the
full lint-gate story.

## Calendar export as-built

`components/AddToCalendar.tsx`, using `add-to-calendar-button-react` `^2.14.0`:

- Loaded via `next/dynamic` named-export import with `{ ssr: false }` — it's a Web Component and hydration-mismatches under SSR. Keep it that way.
- **ALWAYS supply `endTime`**: the lib rejects timed events with no end. `endTime = event.endTime ?? defaultEndTime(event.time)` — `defaultEndTime` (`lib/format.ts`) adds 1h, capping at `23:59` so it never rolls past midnight. `endDate = event.endDate ?? event.date`.
- Props as shipped: `name`, `description` sliced to 500 chars, `startDate`/`startTime`, `timeZone={event.timezone}`, `location` = `event.url` when online else `` `${venue}, ${city}` ``, `options={['Google','Outlook.com','Microsoft365','Apple','iCal']}`, `buttonStyle="round"`, `lightMode="dark"`, `hideBackground`, `size="5"`, `label="Add to calendar"`.
- Yahoo is NOT offered despite ADR-006 promising it — open question (intentional scope vs. oversight); don't add it without direction.
- Analytics: `calendar_add_clicked` is captured via `onClickCapture` on the wrapper `<div>` (the button lives in a web component, so capture-phase on the wrapper is the reliable hook), props `{slug, title, source}`.

## PostHog — frozen analytics contract

Event names are a live contract with dashboards; **renaming any of them needs gordon**.
Complete capture inventory as of 2026-07-20 (grep-verified — these are ALL of them):

| Event | Where | Props |
| --- | --- | --- |
| `event_card_clicked` | `EventCard.tsx`, `EventRow.tsx` | `title, slug, organizer, city, date, time, source`; row adds `view:'row'` |
| `filter_applied` | `FilterBar.tsx` (apply + clearAll) | the `updates` record, or `{cleared:true}` |
| `search_performed` | `SearchBox.tsx` | `{q}` (non-empty only) |
| `calendar_add_clicked` | `AddToCalendar.tsx` | `{slug, title, source}` |
| `register_link_clicked` | `RegisterButton.tsx` | `{slug, title, source, url}` |
| `explore_events_clicked` | `ExploreBtn.tsx` | none |

Wiring: `instrumentation-client.ts` at repo root (Next 16 client-instrumentation
convention) inits `posthog-js` with `process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`,
**hardcoded** `api_host: "/ingest"`, `ui_host: "https://us.posthog.com"`, `defaults:
'2026-01-30'`, `capture_exceptions: true`, debug in dev. `next.config.ts` provides the
reverse-proxy: three `/ingest` rewrites (`/ingest/static` and `/ingest/array` →
`us-assets.i.posthog.com`, `/ingest` → `us.i.posthog.com`) plus
`skipTrailingSlashRedirect: true` (required for PostHog trailing-slash requests — don't
remove it). Trap: `NEXT_PUBLIC_POSTHOG_HOST` in `.env.example` is **read by nothing**;
only `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` matters.

## API routes as-built (frozen — extend only via change control)

Four routes, all `runtime='nodejs'` + `dynamic='force-dynamic'`, all `await connectDB()`
first. Zero in-repo consumers except the GitHub Actions cron hitting `/api/refresh`
(operations: see `northbound-run-and-operate`).

| Route | Status |
| --- | --- |
| `GET /api/events` | External API surface only. Source-list and projection drift **fixed 2026-08-16** — see below; some semantic drift remains |
| `GET /api/events/[slug]` | **Fixed 2026-08-16**: both this route and the page path (`getEventBySlug`) now lowercase the slug before lookup — the mixed-case-404 inconsistency is closed |
| `POST /api/bookings` | **Orphaned** — no UI consumer; `RegisterButton` links out to the source instead. Validates ObjectId+email, 201/409 (dup `eventId+email`)/400. Do not build UI against it without direction |
| `POST /api/digest` | Daily interest-digest trigger (ADR-021), Bearer `CRON_SECRET` — belongs to `northbound-run-and-operate` |
| `POST /api/refresh` | Cron scrape trigger, Bearer `CRON_SECRET` — belongs to `northbound-pipeline-engineering` / `northbound-run-and-operate` |

`lib/events.ts`'s header claim that the API keeps "the same filter semantics" is **now
mostly true** for source coverage and response shape; some semantic drift is still open —
do not "fix" the remaining rows without change control, third parties may depend on the
API as-is:

| Axis | `lib/events.ts` (pages) | `GET /api/events` |
| --- | --- | --- |
| `SOURCES` list | 7 incl. `hackathon`, `watchlist` | **Fixed** — same 7-value list, `?source=hackathon` and `?source=watchlist` now work |
| Response shape | `toDoc()` projection | **Fixed** — route now projects out `_id`/`fingerprint`/`sourceId`/`__v` (`EXCLUDE` const in `app/api/events/route.ts`); no more leak |
| Default date scope | `from = todayInToronto()` | still none — returns past events by default |
| includeOngoing / `_eff` sort | yes (hackathons) | still absent |
| Limit clamp | 1–60, default 18 | still 1–100, default 20 |
| Category param | `category` only | still `category` OR `type` synonym |
| Tag filter | single exact match | still repeatable `?tag=` combined with `$in` |

## Dead-CSS and dead-code warning list — mostly cleaned up 2026-08-16

The items below were previously defined-but-wired-to-nothing; most have now been deleted
outright rather than left as bait for a future "hook it back up":

| Item | Where | Story |
| --- | --- | --- |
| `.reveal` + `reveal-up` keyframes | ~~`globals.css`~~ | **Removed 2026-08-16.** Was dead since `6a886a4`; gone from the stylesheet now, not just unused |
| `.skeleton-overlay` + `shimmer` | ~~`globals.css`~~ | **Removed 2026-08-16.** `EventImage` still uses a static `bg-dark-200` box + DOM opacity fade — unchanged behavior, dead CSS deleted |
| `cv-card` / `cv-row` | ~~`globals.css`~~ | **Removed 2026-08-16.** content-visibility utilities, dead since `6a886a4` (fought Lenis) |
| `@custom-variant dark` | ~~`globals.css`~~ | **Removed 2026-08-16.** Vestigial shadcn scaffolding; no `.dark` toggle ever existed |
| `CITIES` + `COUNTRY_FLAG` | ~~`lib/constants.ts`~~ | **Removed 2026-08-16.** City dropdown was already data-driven via `distinctCities()`; flags now come from `eventFlag()` in `lib/format.ts`, keyed by `region` (see formatters note below) |
| `ogl` | ~~`package.json`~~ | **Uninstalled 2026-08-16.** Zero imports; leftover from the removed WebGL LightRays |
| Stale comment | `components/SmoothScroll.tsx` | Still claims reveal animations exist — not touched by this pass, still worth fixing if you're in that file |

Kept on purpose (do not remove): the `.lenis` companion styles block (`html.lenis`,
`.lenis-smooth`, `[data-lenis-prevent]`, `.lenis-stopped`) — Lenis requires it, it is not
dead CSS despite living in the same neighborhood as the items above.

One live sharp edge in the same territory: `components/CompanyDirectory.tsx` is
`'use client'` and imports `COMPANY_DIRECTORY`/`INDUSTRY_ORDER` from
`lib/fetchers/config.ts` — the scraper registry ships in the client bundle. `config.ts`
must stay client-importable: no `'server-only'`, no secrets, ever.

## When NOT to use this skill

- **Scrapers, normalization, Event schema, dedup, fetcher config** → `northbound-pipeline-engineering`; platform domain knowledge → `northbound-source-platforms-reference`.
- **Classifying/gating a change, ADRs, the four hard rules** → `northbound-change-control`.
- **A symptom you can't yet localize** (blank feed, 500s, slow page) → `northbound-debugging-playbook`; past investigations and removals → `northbound-failure-archaeology`.
- **Load-bearing architecture decisions and invariants** → `northbound-architecture-contract`.
- **Env setup, env-var catalog, dependency installs** → `northbound-build-and-env`; running dev/scrapes/deploys and prod-DB etiquette → `northbound-run-and-operate`.
- **Measuring (source health, coverage, DB sanity)** → `northbound-diagnostics-and-tooling`; evidence bars and acceptance thresholds → `northbound-validation-and-qa`.
- **Editing docs of record / public claims** → `northbound-docs-and-writing`.

## Provenance and maintenance

Authored 2026-07-20 from repo state at commit `63a965a` (branch `main`) + verified
commands; every file/identifier claim was read from source in-session. Commit hashes
cited (`ded4973`, `0b21f84`, `6a886a4`, `40b8c19`, `63a965a`, `2b8c7b9`) verified via
`git log`. Volatile facts and how to detect drift:

| Volatile fact (as of 2026-07-20) | One-line re-verification |
| --- | --- |
| `/events` param list (12 params) | `grep -n "first(sp\.\|sp\.q\|laneFrom" app/events/page.tsx` |
| Lane derivation consolidated into `lib/constants.ts` (`laneOf`/`laneFromParams`/`LANE_ACCENT`, no local copies) | `grep -rn "laneOf\|laneFromParams\|LANE_ACCENT" app components lib --include='*.ts*'` (expect all hits to be the import or the `lib/constants.ts` definition) |
| PostHog capture inventory (6 names, 8 call sites) | `grep -rn "posthog.capture" app components lib --include='*.ts*'` |
| weserv proxy URL pattern + widths (640/240/1280) | `grep -n "weserv\|w = 640\|w={240}\|w={1280}" components/EventImage.tsx components/EventRow.tsx app/events/\[slug\]/page.tsx` |
| `.glass` still solid (no backdrop-filter) | `grep -n -A2 "utility glass" app/globals.css` |
| Dead CSS (`.reveal`/`skeleton-overlay`/`cv-card`/`cv-row`/`@custom-variant dark`) stays removed | `grep -n "reveal\|skeleton-overlay\|cv-card\|cv-row\|custom-variant dark" app/globals.css` (expect no output) |
| API `SOURCES` includes `hackathon` + `watchlist` (7 values, matches `lib/events.ts`) | `grep -n "const SOURCES" app/api/events/route.ts lib/events.ts` |
| Calendar options list (no Yahoo) | `grep -n "options=" components/AddToCalendar.tsx` |
| Lenis config (lerp 0.1, offset -96) | `grep -n "lerp\|offset" components/SmoothScroll.tsx` |
| queryEvents clamps (1–60/18) vs API (1–100/20) | `grep -n "Math.min(Math.max" lib/events.ts app/api/events/route.ts` |
| `/api/bookings` still orphaned | `grep -rn "api/bookings" app components lib --include='*.tsx' --include='*.ts'` |
| `NEXT_PUBLIC_POSTHOG_HOST` still unread | `grep -rn "NEXT_PUBLIC_POSTHOG_HOST" --include='*.ts' --include='*.tsx' app components lib instrumentation-client.ts` |
| Home diverse aggregation (one per organizer) | `grep -n -B2 -A8 "diverseCompanyEvents" lib/events.ts` |
| Token values match DESIGN.md | `grep -n "color-primary\|color-amber\|background:" app/globals.css \| head` |
| Contrast: solid light-200 passes all surfaces (6.06/5.67/4.90); `/80` and `/60` modifiers fail AA | recompute from the token hexes via `northbound-proof-and-analysis-toolkit` Recipe 7 (valid only while tokens are unchanged) |
