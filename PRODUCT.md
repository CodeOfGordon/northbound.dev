# Product

## Register

product

## Users

Developers, engineers, data/AI practitioners, and CS students — primarily in Canada
(Greater Toronto Area, Ottawa, Montreal, Quebec City), then the wider North-American and
online scene. They are technical, time-poor, and skeptical of low-signal listing sites.
Their context: scanning quickly between work and life to answer "what's actually worth
going to this week?" — official events from companies they respect (Google, AWS, NVIDIA,
YC, Databricks…), hackathons (MLH, Devpost, ETHGlobal, DoraHacks), and credible local
meetups — without wading through promoted spam.

**Job to be done:** find a relevant, real, upcoming event fast, trust that it's current
and not a duplicate, and get it onto their calendar or to the source's registration page
with minimal friction.

## Product Purpose

Northbound is one clean, deduplicated feed of **official dev events from big tech & AI
companies**, **hackathons**, and **credible community tech events**, auto-scraped from
many sources (Luma, MLH, company calendars, Devpost/DoraHacks/ETHGlobal, Eventbrite,
Meetup), normalized into a single shape, deduplicated by fingerprint, and exportable to
Google / Outlook / Apple / iCal.

It exists because the real signal — "which official, current tech events should I go to" —
is scattered across a dozen platforms and buried under promoted clutter on the
general-purpose ones. Northbound aggregates the sources worth trusting, drops duplicates
and stale "marathon" listings, and presents them as a calm, dense, date-grouped feed.

Success looks like: a user lands, finds an event that fits in a few seconds, trusts that
it's fresh (the "updated X ago" indicator), and leaves to register or adds it to their
calendar. The product wins by being the highest signal-to-noise tech-events surface its
users know, and by feeling unmistakably *theirs* rather than a generic listings template.

## Brand Personality

**Calm, technical, confident.** The voice is precise and unembellished — it states what
an event is and when, and gets out of the way. Reference feel: lu.ma's date-grouped
density, Linear's restraint and type hierarchy, Vercel's dark technical polish. It should
read as a tool built by people who go to these events, not a marketing funnel.

Emotional goals: **trust** (current, deduplicated, real), **ease** (find-and-go, no
friction), and a quiet **distinctiveness** — it should be visibly *not* a run-of-the-mill
events site. The dark, dense, mono-accented aesthetic is a deliberate point of view, not
a safe default; creativity in the UI is a feature, not a risk to be minimized.

## Anti-references

Northbound should explicitly NOT look or feel like:

- **Eventbrite / Meetup listing clutter** — ad-heavy, promoted-spam, low signal-to-noise,
  generic stock-photo cards. The opposite of why this product exists.
- **Corporate SaaS / admin dashboards** — enterprise chrome, persistent sidebars, KPI/
  hero-metric cards, the generic blue-and-gray B2B look. This is a reading/browsing
  surface, not an admin tool.
- **AI-slop landing pages** — gradient-mesh heroes, an eyebrow kicker above every section,
  numbered `01 / 02 / 03` section scaffolding, decorative glassmorphism, the
  2024–25-era generated-landing aesthetic. Distinctiveness must be earned, not faked.
- **Cutesy consumer event apps** — colorful, over-rounded, illustration-heavy,
  social-first (Partiful / Bevy energy). Northbound is technical and grown-up, not playful.

## Design Principles

1. **Signal over noise.** The reason to exist is cutting through clutter. Every screen
   privileges relevance and recency over volume; density is fine, but it must stay calm
   and legible. Never add chrome that competes with the events themselves.
2. **Lead with the event.** Browsing leads with content, not controls. Filters collapse
   into one popover; the feed is the hero. The user should be reading events within a
   second of arriving, not configuring a query.
3. **Earn distinctiveness.** Take a real visual point of view (dark, dense, mono-accented,
   technical) rather than defaulting to safe. Standing out from generic event sites is an
   explicit goal — but distinctiveness comes from craft and restraint, not from slop
   effects. Creativity operates above an accessibility floor, never below it.
4. **Trust through freshness & provenance.** The product's credibility is that it's current
   and deduplicated. Make freshness ("updated X ago"), the source, and whether something
   is official vs. community visible — provenance is a feature, not metadata.
5. **Frictionless exit.** Success is the user leaving — to register at the source or to
   their calendar. Optimize the path *off* the site; never trap, gate, or pad the route to
   the action that matters.

## Accessibility & Inclusion

Target **WCAG 2.2 AA** as a floor: ≥4.5:1 contrast on body text (≥3:1 on large text and
meaningful UI), full keyboard operability with visible focus, correct landmarks/heading
order, labelled controls, and a `prefers-reduced-motion` alternative for every animation.

AA is a **floor, not a ceiling on creativity**: where an ambitious visual treatment and
the AA bar conflict, solve for both (shift the token, raise the contrast, add a non-color
signal) rather than dropping the treatment or dropping the standard. The dark, dense
aesthetic and the distinctive feel are the point — accessibility is how we make them work
for everyone, not a reason to make them generic.
