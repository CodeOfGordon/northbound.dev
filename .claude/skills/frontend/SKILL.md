---
name: frontend
description: RETIRED 2026-07-20 — do not use. This pre-implementation skill prescribes SWR (never installed — client state is URL searchParams + server components) and fixes for bugs already fixed. Load northbound-frontend-engineering instead.
---

# RETIRED — do not follow this skill

Known-wrong content it used to carry: SWR for client fetching (`swr` is not in
`package.json` and appears nowhere in the code), an `EventCard` prop bug and a
quoting bug that were fixed long ago, and a proposed `lib/events.ts` far simpler
than the real `queryEvents`/`getHomeSections` layer.

**Use instead:**

- `northbound-frontend-engineering` — pages, filter-state contract, lanes, scroll-perf conventions, design compliance.

Original content recoverable via `git log -- .claude/skills/frontend/`.
