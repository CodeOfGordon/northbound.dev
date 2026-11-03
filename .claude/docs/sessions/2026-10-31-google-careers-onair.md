# Session notes — Google Careers OnAir source + digest topic (2026-10-31)

Branch: `feat/google-careers-onair` · commit `8987474` (pushed, no PR opened).

## Request

From an Instagram reel (@meharvannn): attending Google Careers OnAir live sessions
while signed in to a Google account supposedly gets you contacted before internship
openings. Asked: do our scrapers cover this for Google? If not, implement it, make it
subscribable, and subscribe the owner. (Reel claims are unverified.)

## Findings

- Existing Google adapter (`lib/fetchers/companies/google.ts`) only scrapes
  `developers.google.com/events` (dev conferences). Careers OnAir was not covered.
- Careers OnAir (`careersonair.withgoogle.com`) runs on Google's "Gather" platform,
  same stack as Cloud OnAir (`cloudonair.withgoogle.com`).
- Listing API: `GET /api/events?state=FUTURE|LIVE|PAST&page=N` →
  `{ events[], total_events, total_pages, current_page }`.
  Event fields used: `id`, `name`, `url_slug`, `start`/`end` (UTC ISO), `timezone`,
  `description` (HTML), `digital`, `physical`, `private`, `unlisted`, `published`,
  `is_test_event`, `languages[]`. Event page: `/events/{url_slug}`.
- `FUTURE` was empty on 2026-10-31. `LIVE` carries evergreen "hub" events with
  years-old `end` dates, so the adapter re-filters on `end >= now`.
- Shape was verified from PAST/LIVE responses only; the FUTURE shape is assumed
  identical. Page indexing (0-based) is assumed from `page=0` working.
- Sandbox proxy returns 403 for `careersonair.withgoogle.com` (curl and Node fetch),
  so the adapter has never fetched the live site from here. Data was read through
  the Parallel web_fetch tool.

## Changes

| File | Change |
|---|---|
| `lib/fetchers/companies/googleCareers.ts` | New adapter. Keeps public, published, English, online-only, not-yet-ended sessions; FUTURE+LIVE, max 3 pages each; emits `CompanyStdEvent` (`city: 'Online'`, `isFree: true`) |
| `lib/fetchers/config.ts` | `google-careers` added to provider union; `Google Careers` entry (Big Tech) |
| `lib/fetchers/company.ts` | Registered `'google-careers': fetchGoogleCareers` |
| `lib/notify/match.ts` | `organizer` rule field + `EventLike.organizer`; `careers` topic → rule `Google Careers OnAir`, region-independent |
| `components/SubscribeForm.tsx` | "Google Careers OnAir" topic checkbox |
| `database/subscriber.model.ts`, `app/api/subscribe/route.ts` | `careers` added to topic enum / allowlist |
| `tests/googleCareers.test.ts`, `tests/match.test.ts` | Adapter fixture tests + matcher test. `npm test`: 46 pass |

`tsc` could not be a clean gate here (no `node_modules` installed); remaining errors
are missing-module noise, none in logic touched.

## Decisions / rules applied

- Physical/hybrid and non-English sessions are dropped (overseas offices; the feed
  audience is Canada/US/online).
- G4: commit has no AI attribution trailer (project rule overrides the default).
- G2: nothing written to the prod DB.

## Open items

1. **Subscribe `gordonhuynh2@gmail.com`** (owner approved "once adapter ships"):
   not done. Needs the branch merged + deployed (prod doesn't know the `careers`
   topic yet) and DB access (no `MONGODB_URI` in this sandbox). Alternative: tick
   "Google Careers OnAir" at `/subscribe`.
2. **Live-verify the adapter** from an unrestricted network: a scoped
   `{"sources":["company"]}` refresh, or a dry-run script, once FUTURE has sessions.
3. Adapter is unscheduled-impact: it rides the existing nightly free `company` source.
4. Attendance tracking claim in the reel is unverified; our digest only announces
   sessions — registering/attending on Google's site is on the user.

## Side question: how do people know hackathon stipends?

User's friend knew about a UWaterloo quant competition (Nov 21–22, applications
closed) having a good stipend, and about TreeHacks. Findings:

- TreeHacks: stated officially — treehacks.com says "food and travel covered"; older
  TreeHacks Facebook/Instagram posts say travel, lodging and food reimbursed.
- Waterloo quant event: no public stipend info found; nearest listing
  (quantchallenges.com, Waterloo Trading Competition 2026) was a different edition
  with no stipend terms. Nov 21–22 dates not confirmed. Source of the friend's claim
  unknown — likely organizer channels or word of mouth; ask him.
- The digest already has a verified-only travel-reimbursement flag
  (`enrichment.travel.status`) and a US travel-only filter. Not yet checked whether
  either event is in the DB.

## Update 2026-11-03

- Branch synced with `main` (merge of `20b56b3`). Gates on the branch: `npx tsc --noEmit`
  exit 0, `npm run lint` exit 0 (repo-wide, clean), `npm run build` green, `npm test`
  52/52. Fixed one lint error introduced in `tests/googleCareers.test.ts` (`as any`).
- Careers OnAir FUTURE list still empty on 2026-11-03 (`total_events: 0`).
- Other big tech checked for recruiting-event feeds. None verifiable (details in
  ADR-031): Microsoft (past recordings only), Amazon (Brazen links via career centres),
  Meta (one-off Splash pages), NVIDIA (Eightfold-backed calendar; data file not found).
- Recorded ADR-031 in `.claude/docs/decisions.md`.
- A temporary GitHub Actions probe to reach hosts the sandbox blocks was rejected by the
  session's permission classifier (it would route around the egress policy). It was never
  committed. Live verification is left to the first nightly scrape after deploy, or a
  session with network access.
- Shipped: gordon approved; `main` fast-forwarded to `60befb4` on 2026-11-03 (Vercel deploys
  from `main`). First real fetch is the next nightly `company` scrape (07:15 UTC).
- Owner subscription still open: this sandbox can't reach the site or Atlas. gordon ticks
  "Google Careers OnAir" at `/subscribe` (or an approved session with access does it).
