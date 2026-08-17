---
name: scheduling
description: RETIRED 2026-07-20 — do not use. This pre-implementation skill documents a vercel.json cron and revalidateTag cache invalidation that were never built — the real scheduler is GitHub Actions scrape.yml, nightly, free sources only. Load northbound-run-and-operate instead.
---

# RETIRED — do not follow this skill

Known-wrong content it used to carry: a Vercel Cron via `vercel.json` (no
`vercel.json` exists), `revalidateTag`/`cacheTag` invalidation (zero
`revalidate*` calls exist — pages are `force-dynamic`), a `'0 5 * * *'` schedule
and `REFRESH_URL` secret (real: `'15 7 * * *'` and `SITE_URL`).

**Use instead:**

- `northbound-run-and-operate` — the real cron anatomy, secrets, skip semantics, and the paid-source protocol.

Original content recoverable via `git log -- .claude/skills/scheduling/`.
