# Plan: application-first hackathon tracking

**Status:** Proposed, 2026-09-28. Becomes ADR-029 once gordon accepts it.
**Trigger:** gordon found out from Instagram that HackPrinceton hacker applications were closing
*today* (the event is in November), and Northbound had just reported Cal Hacks applications as
open after they had closed. Both are the product's core promise failing: *hear about a
hackathon while you can still apply*.

This plan does three things:

1. It removes the "How far ahead?" lead-time option (`minDaysOut`).
2. It makes the state of hacker applications, checked at the moment anything is read, the
   thing that decides relevance.
3. It models priority, regular, international and travel deadlines separately, so an
   applicant from abroad sees the deadline that applies to them.

---

## 1. What went wrong (traced in code)

### 1a. HackPrinceton: closing today, never surfaced

**Facts.** These were found by web search on 2026-09-28. The sandbox proxy blocked live page
fetches, so they come from search-index snippets and still need a live confirmation.

- **Event:** HackPrinceton Fall 2026 runs **Nov 13–15, 2026**. The site is `hackprinceton.com`.
- **Apply portal:** `my.hackprinceton.com`, which is a sign-in page.
- **Deadline:** **Sept 28, 2026**. It was announced on HackPrinceton's social accounts, e.g. a
  Facebook post titled "applications close in just 12 days". The indexed text of
  `hackprinceton.com` contains **no deadline string at all**.
- **Priority tier:** none found for Fall 2026. The Fall 2025 cycle appears to have had a priority
  and a regular tier (unconfirmed).

Code causes, in the order a signal has to survive them:

| # | Where | What happens |
|---|---|---|
| 1 | `lib/data/watchlist.ts` | HackPrinceton is **not on the watchlist**, so it exists only if MLH season data lists it. MLH carries no application fields, so its application state depends entirely on the enrichment regex. *Whether an F26 doc exists in prod is unverified: the MongoDB MCP failed to connect this session and no `MONGODB_URI` is set here. A read-only query is step 0 of Phase 1.* |
| 2 | the site itself | The deadline appears **only in social posts and behind a sign-in portal**. No HTML classifier, however good, reads it from `hackprinceton.com`. Getting this case right takes **curation**, plus a **"deadline not published" risk flag** that tells you to go check (F6), not better regexes alone. |
| 3 | `scripts/enrich-hackathons.mjs` `extractDeadline()` | Even when a site does state deadlines, this returns the **first** "apply/register … by/due/deadline/closes … <MonthName> <day>" match. "Priority deadline: Sep 13 · Regular: Sep 20" yields nothing or one arbitrary date. There is no concept of deadline *kinds*. |
| 4 | `lib/notify/match.ts:69` + `lib/notify/digest.ts:152-157` | `minDaysOut` is checked against the event **start date** in *every* digest section, including deadline reminders. HackPrinceton (Nov 13) is 46 days out and clears even the "6 weeks" option (45) **by one day**, which shows how arbitrary the gate is. Cal Hacks (Oct 23) was 33 days out on its Sep 20 deadline day and 40 days out on its Sep 13 priority day, so a "6 weeks" subscriber would have lost **both of its deadline reminders**, even if the deadlines had been parsed (they weren't, see §1b #2). The option was a proxy for "applications are probably still open", and it is the wrong proxy. |
| 5 | `lib/notify/digest.ts` deadlines loop (`if (!isOpen(d)) continue`) | Deadline reminders require status `open`. A **known deadline with status `unknown`**, which is common on SPA sites where no "apply now" text is found, **never produces a reminder**. |
| 6 | `lib/hackathon.ts` `applicationSignal()` | Deadlines are compared as a Toronto calendar date (`deadline < todayToronto()`). A deadline of "11:59 PM PT" is still open for 3 hours after Toronto midnight. More importantly, nothing distinguishes "closes **today**" from "closes in 3 weeks". |
| 7 | `app/events/page.tsx` hackathon lane | The lane is a 6-month window grouped by **event month**. A November hackathon closing today sits in the November group, and nothing marks it as urgent. |

### 1b. Cal Hacks: shown open after it closed

**Facts** (search snippets, as above):

- **Event:** Cal Hacks 13.0 runs **Oct 23–25, 2026**.
- **Deadlines:** the site says "apply at hive.hackberkeley.org by **9/13 (priority) / 9/20
  (regular)**". Priority applicants hear back by Sep 17. **Applications closed Sep 20.**
- **Portals:** the real apply portal is on a **different host** (`hive.hackberkeley.org`).
  `apply.calhacks.io` is still indexed as the **Cal Hacks 12.0** portal.
- **After closing:** the cached landing page still carries the "apply … by 9/13 / 9/20"
  wording.

| # | Where | What happens |
|---|---|---|
| 1 | `lib/data/watchlist.ts` | Cal Hacks is a watchlist entry, and **all** of its application state comes from the enrichment regex on `calhacks.io`. |
| 2 | `extractDeadline()` | It only parses **month names** ("September 20"). Numeric **`9/13` / `9/20`** never match, so no deadline was stored. **This is the decisive miss.** With `9/20` stored, the existing passed-deadline rule would have forced `closed` on Sep 21, whatever text lingered on the page. |
| 3 | `OPEN_RES` in `enrich-hackathons.mjs` | Bare CTAs such as `apply now|here|today` and `register now` count as "open" **in any context**. Mentor, volunteer and judge "Apply now" buttons, and hero buttons nobody removed, outlive the hacker application. The classifier has no idea what *hacker* applications are. |
| 4 | same | The **apply portal is never fetched**, only the landing page and one FAQ page. Cal Hacks also shows that a portal must be found by **following the link on the current page, across hosts**. Guessing `apply.<site>` would land on last year's form. |
| 5 | `isStale()` + `hosts.slice(0, BUDGET)` | An `open` result is only re-checked every 3 days (event < 60 days out) or every 7 days (otherwise). Hosts are taken in **Mongo insertion order** up to 25, under a 12-minute cap, so an urgent host can be deferred run after run. |
| 6 | `applicationSignal()` + `EventRow`/`EventCard` | With no deadline known, nothing can force `closed`. The badge says "Apps open" with no age attached. The detail page shows evidence and "checked X ago" for **travel**, but not for applications. |
| 7 | `lib/fetchers/devpost.ts:99-100` (a related false-open source, not the Cal Hacks cause) | Devpost `open_state` `open`/`upcoming` maps to `applicationStatus: 'open'`, and the **end of the submission window** becomes `applicationDeadline`. For **in-person** Devpost hackathons the submission window *is* the event, so an event whose hacker applications closed weeks ago reads "open until the last day of the event". ADR-019 flagged this mapping "revisit if wrong". It is wrong for the in-person slice. |
| 8 | `lib/events.ts` `applications=open` filter | The filter ORs the scrape and enrichment statuses, but `applicationSignal()` gives the scrape status precedence. The filter and the badge can disagree (minor). |

---

## 2. The contract (principles every surface follows)

- **P1 — Application state decides relevance, not event distance.** A hackathon is actionable
  when hacker applications are not closed *for this applicant*. When the event runs doesn't
  matter.
- **P2 — Evaluated at read time.** The feed, the detail page and digest composition all compute
  state from the stored deadlines and observation timestamps against `now`, at the moment
  they are read. A stored status string is an observation, not the answer.
- **P3 — "Open" carries an age.** Say "Apps open" only when it was verified recently (≤ 48 h) or
  a future deadline backs it. Otherwise say "Open as of Sep 24, confirm on the site".
- **P4 — Deadlines depend on the applicant.** Priority, regular, international and travel are
  separate dates. The applicant's own **act-by deadline** drives the badge, the sort order and
  the reminders. For someone coming from abroad or needing travel support, that is the
  priority tier while it is still open (F2).
- **P5 — Hacker applications only.** Mentor, volunteer, judge, sponsor and speaker applications
  never count as evidence.
- **P6 — Existing doctrine, extended.** Silence is never "closed", but a passed *final*
  applicable deadline is. A passed *priority* deadline alone never closes anything.

---

## 3. Features

### F1: Remove "How far ahead?" (`minDaysOut`)

| File | Change |
|---|---|
| `components/SubscribeForm.tsx` | Delete `LEAD_TIMES`, the `lead` select, the `minDaysOut` state, and its field in the PostHog `digest_subscribed` payload. |
| `app/api/subscribe/route.ts` | Stop parsing and `$set`ting `minDaysOut`. |
| `lib/subscribers.ts` | Drop `minDaysOut` from the returned prefs. |
| `database/subscriber.model.ts` | Remove the field from `ISubscriber` and the schema. Existing docs keep the stale key, and no `$unset` migration runs, because that is a prod-DB write (G2). Cleanup is optional and needs gordon's OK. |
| `lib/notify/match.ts` | Remove `minDaysOut` from `InterestRule`, `SubscriberPrefs`, `rulesForSubscriber()`, and the date check at line 69. Hackathon rules gain `requireApplicable: true`, which calls `applicationState()` (F2) and rejects `closed` for that subscriber's applicant profile. |
| `lib/notify/digest.ts` | Stop passing `minDaysOut`. |
| `app/subscribe/page.tsx` | Update the pitch copy to "Told the day we see a hackathon's applications open, however far away the event is". |
| `app/events/page.tsx` | The hackathon lane's default switches from "next 183 days by event date" to the application-first view (F5). The `from`/`to` presets stay available as explicit filters. |
| `scripts/enrich-hackathons.mjs` | Selection stops being `date <= today + 183`. It becomes "event not over, apps not closed-and-final", bounded at 12 months. Urgency ordering (F3c) keeps the budget honest. |

### F2: Deadline model: priority vs regular, and applicants from abroad

**Stored shape** (enrichment-owned, under `enrichment.application`, so ADR-018's wipe-safety
rule is untouched because the scrape never writes this path):

```ts
interface AppDeadline {
    kind: 'priority' | 'regular' | 'international' | 'travel';
    date: string;              // YYYY-MM-DD (I5: lexical compare)
    time?: string;             // HH:MM when the site states one ("11:59 PM")
    tz?: string;               // IANA when stated ("PT" → America/Los_Angeles, "AoE" → Etc/GMT+12)
    audience: 'all' | 'domestic' | 'international' | 'restricted';
    audienceNote?: string;     // restricted: who it's for ("Stanford students only")
    source: 'site' | 'curated' | 'platform';
    evidence?: string;         // ≤ 280 chars, like the other evidence fields
    extendedFrom?: string;     // YYYY-MM-DD this replaced ("extended until …")
}
// enrichment.application gains:
//   deadlines: AppDeadline[]
//   rolling?: boolean          // "reviewed on a rolling basis": apply early, no hard date
//   openSeenAt?: string        // ISO, last time hacker apps were observed open
//   closedSeenAt?: string      // ISO, last time they were observed closed
// enrichment.application.deadline stays, written as the final all-audience deadline,
// until every reader has moved to deadlines[]. Then it is dropped.
```

- **Kinds.**
  - `priority` means early/priority/early-bird. It brings a first-round decision (Cal Hacks
    priority applicants heard back 4 days after their deadline), and sometimes first claim on
    travel money (HackGT's "Early Bird & Travel Reimbursement" round).
  - `regular` means general/final.
  - `international` is an earlier cut-off for applicants outside the host country. **The survey
    found none at the majors.** Visa guidance comes *after* acceptance (e.g. Hack the North:
    "start immediately after receiving your offer"). The kind stays in the model for the rare
    event that uses it, but the abroad logic does not depend on it.
  - `travel` means "apply by X to be considered for travel reimbursement".
  - `audience: 'restricted'` covers tiers the viewer usually can't use, such as TreeHacks' Oct 19
    priority deadline for Stanford students only. These are shown, never used as the
    viewer's deadline.
- **Devpost's scrape-owned `applicationDeadline`** is read as
  `{ kind: 'regular', audience: 'all', source: 'platform' }`, for the **online slice only**.
  The in-person slice stops emitting it (F3f).
- **Curated per-edition deadlines.** `scripts/hackathon-overrides.json` currently refuses
  application data because it "would rot". Deadlines are safe there if each block is **pinned
  to one edition**, so it can't rot silently:

  ```json
  "hackprinceton.com": {
    "editions": [
      { "eventStart": "2026-11-13",
        "deadlines": [
          { "kind": "regular", "date": "2026-09-28", "tz": "America/New_York", "audience": "all",
            "evidence": "Curated: HackPrinceton social posts, 'Fall 2026 applications due Sept 28'" }
        ] }
    ]
  },
  "calhacks.io": {
    "travel": { "...": "unchanged" },
    "editions": [
      { "eventStart": "2026-10-23",
        "deadlines": [
          { "kind": "priority", "date": "2026-09-13", "audience": "all" },
          { "kind": "regular",  "date": "2026-09-20", "audience": "all" }
        ] }
    ]
  }
  ```
  A block applies only to the doc whose `date` is within 3 days of `eventStart`, so it goes
  inert on its own once that edition is past. Curated deadlines win over classifier deadlines
  of the same kind. The curated `knownNext` dates on watchlist entries are the precedent.

**Applicant profile, and why priority vs regular depends on it:**

```ts
interface Applicant { country: 'CA' | 'US' | 'OTHER'; wantsTravel: boolean }
// abroad         := applicant.country !== event country (derived from event.region)
// applicable(d)  := d.audience === 'all'
//                || (d.audience === 'international' && abroad)
//                || (d.audience === 'domestic' && !abroad)
//                || (d.kind === 'travel' && wantsTravel)
//                (restricted tiers are never applicable, only displayed)
```

The two kinds of applicant get different "act by" dates:

- **Coming from abroad, or needing travel support: the priority deadline is the act-by
  date.**
  - The hard deadline stays the regular one, but the **priority** deadline is the date that
    matters in practice. Its early decision leaves time to book cross-border travel and, for
    international students (e.g. a student in Toronto who needs a US visa), to start a visa
    the moment the offer lands.
  - Where travel money is tied to the early round, missing it means no funding.
  - The badge reads "Apply by Sep 13 · priority, recommended for you (regular Sep 20)".
    After Sep 13 it falls back to "Sep 20 · regular (priority passed)".
- **Local (same country, no travel support): the regular deadline is the act-by date.** The
  priority tier is shown as a secondary line, "priority Sep 13 for an early decision".
- **The abroad heuristic changes emphasis, never status.** An event is `closed` only when the
  last applicable deadline has passed, for everyone.

**One pure resolver** in `lib/hackathon.ts` replaces `applicationSignal()`. Every surface
calls it and nothing re-derives state:

```ts
applicationState(e: EventDoc, who: Applicant, now: Date): {
    status: 'open' | 'closing_soon' | 'closed' | 'not_yet' | 'unknown';
    actBy?: Due;               // the date to hit: priority if abroad/travel & still future, else regular
    hardDeadline?: Due;        // last applicable deadline, after which it's closed for this applicant
    passed: AppDeadline[];     // e.g. priority passed while regular is still open
    restricted: AppDeadline[]; // shown, never used ("Stanford students only")
    confidence: 'deadline' | 'verified' | 'stale';   // P3
    verifiedAt?: string;
    risk?: 'deadline-unpublished';                  // F6: major, event near, no deadline known
}
type Due = { kind: AppDeadline['kind']; date: string; closesAt: string /* ISO instant */; daysLeft: number };
```

- **closed** when the newest observation is "closed" (`closedSeenAt > openSeenAt`), **or**
  when `hardDeadline` has passed. A passed priority deadline alone never closes.
- **closing_soon** when `actBy.daysLeft ≤ 7`, rendered as "Closes today" / "Closes tomorrow" /
  "5 days left". For an applicant from abroad this fires ahead of the *priority* date, so it
  arrives a week before the tier that matters to them.
- **Instants, not dates.** The `closesAt` instant uses `time` + `tz` when known. Otherwise it is
  23:59 in the **event's** timezone, not Toronto's, so a PT deadline stays open until PT midnight.
- **not_yet** is left alone, since the resolver can't know an opening date. **unknown** plus a
  known future deadline resolves to **open with confidence `deadline`**, which closes the
  digest `isOpen` gap from §1a #5.

**Where the applicant profile comes from:**

- **Site (no accounts exist).** An "Applying from: Canada / US / Elsewhere" control plus a
  "I'd need travel support" toggle in the hackathon lane header. Both persist in a cookie so
  server components can read them per request. The default comes from the
  `x-vercel-ip-country` request header when present, else `CA`. Nothing is stored server-side.
  *Confirm the `cookies()`/`headers()` request APIs in the bundled Next 16 docs before
  building. `node_modules` isn't installed in this checkout, so this plan did not read them.*
- **Digest.** The subscriber gains `homeCountry` (`CA|US|OTHER`, default `CA`) and `wantsTravel`
  (default on when `usTravelOnly` is on). On the form, the "Where?" fieldset gains "I'm applying
  from…", which replaces the removed lead-time select.

### F3: Trustworthy open/closed detection

**F3a. Hacker-scoped classifier.** Move the classifiers from `enrich-hackathons.mjs` into a pure
module, `scripts/lib/classify-application.mjs`, so they can be tested against saved HTML
fixtures.

- **Veto window.** Ignore any open or closed match whose surrounding ±80 chars name
  `mentor|volunteer|judge|sponsor|organi[sz]er|speaker|workshop`.
- **CTAs stop being evidence on their own.** Bare `apply now|here|today` and `register now` only
  count when (i) the same sentence names hackers/participants/applications, or (ii) the link
  they sit on passes the portal check (F3b).
- **More closed phrases.** Add "applications for {edition} have closed", "hacker applications
  are closed", "deadline has passed", "we've reached capacity", and "join the waitlist". The
  last one gives `closed` with `waitlist: true`, rendered as "Waitlist only".
- **Extract all deadlines**, not just the first. Each date is classified by the qualifier in its
  sentence: `priority|early|early[- ]bird|first[- ]round` → priority;
  `international|visa|outside the (US|Canada)` → international;
  `travel|reimburse|stipend|bus` → travel; `regular|general|final|standard` or no qualifier →
  regular.
- **Date formats.** Parse **numeric** dates as well as month names: `9/20`, `09/20/2026`,
  `Sept. 20`, and paired forms like "by 9/13 (priority) / 9/20 (regular)". Numeric dates are
  exactly what Cal Hacks used, and missing them is §1b #2. Read `M/D` as North American
  month/day, and reject any reading that falls after the event start. Also parse times and zone
  abbreviations (ET/EST/EDT/PT/PST/PDT/CT/MT/AoE).
- **Extensions** are common (TreeHacks, PennApps, hackUMBC and HackPrinceton spring were all
  extended in the survey). "Deadline extended to/until …" replaces the older deadline of the
  same kind and records `extendedFrom`.

**F3b. Follow the apply portal.** Find the primary *hacker* apply link **on the current
page**: anchor text matching apply/register with no mentor/volunteer veto, or a known form host
(`forms.gle`, `docs.google.com/forms`, `typeform.com`, `tally.so`, `lu.ma`, `*.devpost.com`).
Cross-host links are expected. Cal Hacks → `hive.hackberkeley.org`, HackPrinceton →
`my.hackprinceton.com`. **Never guess `apply.<site>`**, because `apply.calhacks.io` is last
year's form. Fetch the portal under its own host's robots rules and within the same budget, and
classify it with portal-specific markers:

| Portal | Closed marker |
|---|---|
| Google Forms | "is no longer accepting responses" |
| Typeform | "This typeform is now closed" / "no longer accepting" |
| Tally | "This form is closed" / "no longer accepting submissions" |
| Luma | registration closed / event full / waitlist |
| Custom (`hive.hackberkeley.org`, `my.hackprinceton.com`, …) | the generic closed phrases; a sign-in wall with no phrase → `unknown`, never `open` |

**The portal's answer outranks the landing page's CTAs.**

**F3c. Recheck cadence driven by state, plus urgency ordering** (`isStale()` and host
selection):

| State | Re-check every |
|---|---|
| open or unknown, next deadline ≤ 7 d **or** no deadline known | 24 h |
| not_yet | 48 h |
| open, next deadline > 7 d | 72 h |
| closed (deadline-backed) | 7 d (catches extensions) |
| fetch failed / blocked | 7 d backoff (unchanged) |

- **Day-after checks.** Every known deadline also triggers one check the day after it, to catch
  "extended to …".
- **Urgency order.** Sort stale hosts by next applicable deadline, then `open`/`not_yet` before
  others, then event date, and only then apply `.slice(0, BUDGET)`. Today the order is
  arbitrary.
- **Observation timestamps.** Record `openSeenAt`/`closedSeenAt` on each observation. They drive
  P3.

**F3d. A light pass every 6 hours.** Add an `--apps-only` mode: landing page plus portal, static
fetch only, no travel probes, no archives, no rendering. It covers only hosts whose state is
`open`/`not_yet`, or whose deadline falls within 14 days, and has a hard 5-minute budget. It
runs on a `0 */6 * * *` schedule. Actions minutes are free on this public repo, so the G1 $0
gate holds, and it is a free source only. The nightly full pass is unchanged.

**F3e (optional, Phase 5): verify when a page is read.** A detail-page view whose stored
observation is more than 24 h old triggers
`POST /api/hackathons/[slug]/verify`, which statically fetches the landing page and portal
within 8 s and writes only `enrichment.application`. It is rate-limited through `checkedAt`, so
no caller can cause more than one fetch per host per 6 h. This is the most literal version of
"checked whenever the site is read", but it is also a **public endpoint that writes to prod
Atlas** and runs under Vercel function limits. It is gordon's call, and F3c + F3d may make it
unnecessary.

**F3f. Consistency fixes.**

- **Devpost in-person** (`lib/fetchers/devpost.ts`, §1b #7). For the in-person slice, stop
  emitting `applicationStatus: 'open'` and stop using the submission-window end as
  `applicationDeadline`. That window is the event, not the application. The item stays
  `unknown` unless enrichment finds real evidence, which needs the organizer's own site. Pull
  that URL from the Devpost listing, because `devpost.com` is in `SKIP_HOSTS`. The online slice
  keeps today's mapping, since for online challenges registration really is open until
  submissions close. This amends ADR-019.
- **Filter and badge agree.** `queryEvents({applications:'open'})` uses the same precedence as
  the resolver: fetch candidates with the current `$or`, then post-filter through
  `applicationState()`. The lists are tens of docs.
- **Application provenance on the detail page.** It shows application evidence plus
  "checked X ago · from the event site / curated / Devpost", matching the travel block.

### F4: Digest: deadlines first, and a cadence that can't miss them

- **New section order:**
  1. **Closing soon, apply now.** Every applicable deadline inside the subscriber's window.
     This includes `unknown`-status events with a dated deadline, which fixes §1a #5.
  2. **Applications opened.** Unchanged per-subscriber state (`notifiedOpenIds`).
  3. **New hackathons.** Apps not open yet: "we'll tell you when".
  4. Other topics, unchanged.
- **One reminder per deadline, with a label.** Priority and regular each get their own reminder,
  worded for the subscriber's profile. For a Canadian subscriber: "Cal Hacks: **priority
  Sep 13**, recommended since you'd travel from Canada (regular Sep 20)". For a local
  subscriber: "Cal Hacks: apply by Sep 20 (priority Sep 13 for an early decision)".
- **Urgent alerts bypass cadence.** If a matching hackathon has an **act-by or hard deadline**
  within **72 h** that this subscriber hasn't been reminded of, send even though the
  weekly/biweekly/monthly cadence isn't due. For an applicant from abroad, the priority date
  counts too. That is at most one extra email a day, and it
  carries only the deadline items.
  - It is tracked as `notifiedDeadlineKeys: string[]` (`<eventId>:<kind>:<date>`) and stamped
    through the existing confirm path, so at-least-once delivery is preserved.
  - A new "Always email me about deadlines in the next 3 days" setting defaults to **on**.
- **First sighting within 7 days is urgent.** A hackathon first seen with an applicable
  deadline ≤ 7 days away goes straight to the urgent path. HackPrinceton-style late discoveries
  still get surfaced.
- **P3 in email.** An "open" observation older than 48 h with no future deadline is worded
  "open as of Sep 24", never "open".

### F5: Site: an application-first hackathon lane

- **Default view: "Can still apply".** Anything not closed *for you* is sorted by your next
  deadline, ascending. Open events with no deadline published follow, then "Not open yet".
  "Applications closed" collapses at the bottom, with a toggle. The event-month grouping is
  replaced by deadline buckets: *Closes this week · Closes this month · Later · No deadline
  published · Not open yet · Closed*.
- **Closing-soon strip** at the top of the lane and the home hackathon rail, for deadlines
  ≤ 7 days away.
  - It shows "Closes today", "2 days left".
  - **Styling needs a DESIGN.md decision.** Amber is reserved for the company lane, so urgency
    either uses mint weight/emphasis or adds an approved token.
- **Apply-by column.** Shows *your* act-by deadline with its kind, e.g. "Sep 13 · priority" for
  a viewer applying from abroad or "Sep 20" for a local one, with the other tier on a second
  muted line. On mobile it collapses into the meta line
  as today.
- **Detail page.**
  - A deadline table (Priority / Regular / International / Travel), with the rows that apply
    to you highlighted, plus evidence, source and "checked X ago".
  - A "Confirm on the official site" link.
  - **"Add deadline to calendar"**, which reuses `AddToCalendar` with a synthetic event ("Apply:
    HackPrinceton — priority deadline") at `closesAt`. Deadlines are what people miss, so
    they belong in the calendar too, not just the event.
- **PostHog.** Add `applicant_profile_changed` and `deadline_calendar_add_clicked`. Existing
  event names are kept.

### F6: Coverage: majors shouldn't depend on luck

HackPrinceton showed that some majors **only announce deadlines on social media or behind a
sign-in portal**. No scraper change catches that, so the product has to be honest about what
it doesn't know and push the user to check.

- **Watchlist.** Add HackPrinceton (`hackprinceton.com`, Nov 13–15, 2026). Audit the watchlist
  against a list of NA majors each season. The watchlist is the curated surface for
  per-edition facts (`knownNext` already lives there), so entries gain the same optional
  `deadlines` block as the overrides. gordon, or an agent session, adds a line when a
  deadline is announced.
- **"Deadline not published" risk flag** (`applicationState().risk`). It fires for an in-person
  major that is **≤ 12 weeks from its start** with **no dated deadline**, whether its status is
  unknown or open. It renders as "Deadline not on the site. Majors like this usually close
  5–11 weeks before the event, so check now", with a link to the site. The digest carries it
  once per event.
  - **Band:** from the survey below, regular deadlines fell about 5–15 weeks before the event (Cal Hacks
    4.7, HackPrinceton 6.6, Hack the North 7.6, HackMIT 11, TreeHacks about 15). Flagging at
    12 weeks catches all but the TreeHacks-style long lead.
  - **Prior-edition refinement.** Where a previous edition's deadline is known (from archived
    year subdomains, or curated), show the organizer's own pattern instead: "last year
    applications closed 7 weeks before". It is labelled the same honest way as prior-edition
    travel evidence (ADR-028).
- **Warnings in the enrichment summary** (`::warning::`):
  - watchlist hosts with no upcoming doc;
  - majors carrying the risk flag;
  - curated deadline blocks whose `eventStart` matches no doc.

  These gaps show up in the run log instead of on Instagram.
- **Rejected: scraping Instagram/Facebook** for announcements. It breaks those platforms' terms
  of service, faces heavy anti-bot measures, and would mean paid Apify actors (G1). Curation
  plus the risk flag covers the same gap at $0.

**What real deadlines look like.** This is from the 2026-09-28 survey (search snippets, not
live-verified) and is used to set the defaults above:

| Hackathon | Tiers | Dates / notes |
|---|---|---|
| Cal Hacks 13.0 | priority + regular | 9/13, 9/20 → event Oct 23 (numeric dates on site) |
| HackPrinceton F26 | single (as found) | Sep 28 → event Nov 13; only on social posts / sign-in portal |
| MHacks 2026 | early + regular | Aug 7 (11:59 PM ET), Sep 12 |
| HackGT 13 | early bird + regular | early round bundled with travel-reimbursement applications |
| TreeHacks 2027 | priority (Stanford only) + regular | Oct 19 restricted, Nov 1; 2026 was extended to Nov 2, 11:59 PM PT |
| HackMIT 2026 | single | Jul 4, 11:59 PM ET → event Sep 19 |
| Hack the North 2026 | single | Jul 27, 11:59 PM EDT → event Sep 18; visas start after the offer |
| hackUMBC 2026 | single, extended | "extended … closes September 25th at 11:59pm" |
| Cal Hacks AI 2026 | priority + final | Apr 26, May 17 |

Takeaways:

- Two tiers are common, and extensions are common.
- Times usually carry a zone.
- **No separate international deadline was found anywhere.** "Abroad" therefore changes which
  tier you should hit (F2), not which deadlines exist.
- MLH season JSON has no application/deadline field (its `status` is the event's), and
  Devpost exposes only the submission window. Neither platform can supply hacker-application
  deadlines, so organizer sites plus curation are the only sources.

---

## 4. Rollout: small, shippable phases

| Phase | Scope | Why this order |
|---|---|---|
| **0: Confirm** (read-only) | Query prod for the HackPrinceton F26 / Cal Hacks 13.0 docs and their `enrichment.application` and `checkedAt`. Run `--dry-run --host calhacks.io` to capture what the classifier sees today. | Turns §1's code-level diagnosis into observed fact before anything changes. |
| **1: Stop the bleeding** (≈1 PR) | F1 (remove `minDaysOut`). **Numeric date parsing** (`9/20`), storing the latest date in the existing single `deadline` field. On its own this would have closed Cal Hacks on Sep 21. **Devpost in-person** false-open fix. Digest deadline reminders accept `unknown` + known deadline. Urgency-ordered enrichment queue. Mentor/volunteer veto, and bare CTAs no longer evidence. P3 "open as of" wording. A simple "No deadline published, check the site" label for majors ≤ 12 weeks out. Application evidence + "checked X ago" on the detail page. HackPrinceton added to the watchlist. | Every item is small and fixes one of the observed failures directly, with no schema change. |
| **2: Deadline model** | F2 schema + resolver. Multi-deadline extraction. Curated edition deadlines. Applicant profile (cookie + `homeCountry`/`wantsTravel`). Per-deadline digest reminders + urgent bypass (F4). | The priority/regular/international requirement needs the new shape before any UI can show it. |
| **3: Freshness** | F3b portal following, F3c state-driven cadence, F3d 6-hourly light pass. | Catches closures like Cal Hacks within hours instead of days. |
| **4: Lane redesign** | F5 application-first lane, closing-soon strip, deadline calendar export. | Needs Phase 2 data, plus the DESIGN.md urgency decision. |
| **5: Optional** | F3e on-read verification endpoint. | Only if Phases 3–4 still leave gaps. It carries prod-write and abuse risk. |

---

## 5. Validation (evidence bar per `northbound-validation-and-qa`)

- **Characterization tests.** Use the vitest candidate from the QA skill, run over pure modules
  only:
  - **`applicationState()`:** deadline day in PT viewed from Toronto; priority passed while
    regular is open (status stays open, `passed` lists priority); a CA viewer on a US event →
    `actBy` = priority until it passes, then regular; a local viewer → `actBy` = regular; a
    restricted tier never becomes `actBy`; a stale `open` with no deadline →
    `confidence: 'stale'`; `closedSeenAt > openSeenAt` → closed; a major ≤ 12 weeks out with
    no deadline → `risk`.
  - **`matchEvent()`:** no `minDaysOut`; hackathon rules reject `closed`.
  - **Classifier fixtures:** Cal Hacks' "apply … by 9/13 (priority) / 9/20 (regular)"; a
    closed apply portal; a landing page still showing a mentor "Apply now" after hacker apps
    closed; "extended until …"; and "11:59 PM PT"/"AoE" parsing.
- **Live dry runs** (read-only):
  - `node --env-file=.env.local scripts/enrich-hackathons.mjs --dry-run --host calhacks.io`
    → `closed`.
  - `--host hackprinceton.com` → application `unknown` from the site (the deadline isn't
    published there), and the resolver shows the curated Sep 28 deadline, or, without
    curation, the "deadline not published" risk flag.
- **Digest compose `dryRun`** against prod, read-only: a HackPrinceton-shaped event lands in
  "Closing soon" regardless of how far away its start date is.
- **Gates.** `npx tsc --noEmit` is green. `npm run lint` shows zero new errors or warnings
  against its red baseline.
- **Before/after table** of in-person US/CA hackathons by resolved status, plus a
  "has ≥ 1 dated deadline" count (`db-sanity.mjs` / `source-health.mjs`).

---

## 6. Decisions needed from gordon

1. **Default lane view.** Hide closed-application hackathons (collapsed section, recommended),
   or keep them inline with a "closed" badge?
2. **Urgent digest bypass.** Default on (recommended), capped at one extra email per day?
3. **Viewer country.** Default from `x-vercel-ip-country` (recommended, with the manual
   override always visible), or manual toggle only?
4. **Urgency styling.** Amber is reserved for company events. Mint emphasis, or a new DESIGN.md
   token?
5. **F3e on-read verification.** Build it, or rely on the 6-hourly pass?
6. **Curation list.** Which majors get curated per-edition deadlines this season? The
   suggestion is every watchlist entry plus HackPrinceton, Hack the North and UofTHacks.
7. **Priority-first for applicants from abroad.** Should a viewer applying from another
   country, or needing travel support, be steered to the priority deadline (the act-by date)
   while the regular deadline stays the hard cut-off? Recommended. And should the default
   home country be `CA`?
8. **Stale `minDaysOut` keys.** `$unset` them on existing subscriber docs (a prod write), or
   leave them inert?

---

## 7. Docs to update with the implementation

- **ADR-029** in `.claude/docs/decisions.md`: the deadline model, field ownership, applicant
  resolution, and the retirement of `minDaysOut`. It amends ADR-020 (overrides may now carry
  edition-pinned deadlines), ADR-021/026 (`minDaysOut` gone) and ADR-028 (urgent path
  alongside cadence).
- **`.claude/docs/gotchas.md`**:
  - CTA/mentor false positives;
  - deadline timezone (event zone, not Toronto);
  - "priority passed ≠ closed".
- **`northbound-pipeline-engineering`** and **`northbound-frontend-engineering`** skills: the
  resolver as the single merge point, replacing `applicationSignal()`.
