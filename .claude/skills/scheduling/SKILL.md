---
name: scheduling
description: Use when wiring the nightly scrape trigger and cache invalidation via Vercel Cron or GitHub Actions cron hitting POST /api/refresh.
---

# Scheduling the nightly scrape + cache invalidation

Goal: once a night, hit `POST /api/refresh`, which runs the scrape -> normalize ->
upsert pipeline and then invalidates the cached events feed so users see fresh data.

This skill covers the **trigger** and the **cache busting**. The handler body
(scrape, dedup, `bulkWrite` upsert) belongs to the **backend-api** skill — this
skill only owns wiring the cron, auth, and revalidation. Cross-reference
`.claude/skills/backend-api/SKILL.md` for the upsert/query internals.

> Next.js here is a modified **16.2.6**. The bundled docs at
> `node_modules/next/dist/docs/01-app` are the source of truth. Verified facts used
> below: GET route handlers are **dynamic (uncached) by default**; Mongoose needs
> `export const runtime = 'nodejs'`; `revalidateTag` requires the **two-arg** form
> `revalidateTag('events', 'max')`; `revalidatePath(path, type?)`.

---

## Decision: which scheduler

| Option | Use when | Cost / limits |
|---|---|---|
| **Vercel Cron** (recommended if deploying on Vercel) | App is hosted on Vercel. Zero extra infra; cron config lives in `vercel.json`. | Free/Hobby tier: **once per day max** per cron (good enough for nightly). Pro allows finer schedules. |
| **GitHub Actions cron** | Not on Vercel, or you want scrape logs/retries in CI, or sub-daily on a free plan. | Free minutes; schedule can drift several minutes under GH load. |
| **External cron** (cron-job.org, EasyCron, Upstash QStash) | Need exact timing, retries, and alerting independent of host. | Varies; most have a free tier. |

All three do the same thing: an authenticated `POST` to `/api/refresh`. Pick one;
the endpoint and `CRON_SECRET` validation are identical regardless.

Secrets are **server-only** (no `NEXT_PUBLIC_` prefix): `CRON_SECRET`, `MONGODB_URI`,
`APIFY_TOKEN`. Generate a secret with `openssl rand -hex 32`.

---

## The refresh endpoint — `app/api/refresh/route.ts`

`POST` is never cached, so no special opt-out is needed. The endpoint validates the
caller, runs the pipeline (delegated to backend-api code), then invalidates the feed.

```ts
// app/api/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag, revalidatePath } from 'next/cache';
import connectDB from '@/database/mongodb';
import { runRefresh } from '@/lib/refresh'; // owned by the backend-api skill

export const runtime = 'nodejs';        // Mongoose uses the native TCP driver, not Edge
export const dynamic = 'force-dynamic'; // never prerender/cache this handler
export const maxDuration = 300;         // give the scrape headroom (Vercel fn limit)

export async function POST(request: NextRequest) {
  // 1) Auth — reject anything without the shared secret
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB(); // first awaited line; throws fast if URI missing/unreachable

  // 2) Run the scrape -> normalize -> upsert pipeline (see backend-api skill)
  const result = await runRefresh(); // e.g. { upserted, modified, matched, sources }

  // 3) Invalidate the cached events feed so the next read is fresh
  revalidateTag('events', 'max'); // two-arg form is REQUIRED in Next 16
  revalidatePath('/');            // home feed page (literal path -> no type arg)

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
```

### CRON_SECRET validation

Vercel Cron sends the secret as `Authorization: Bearer $CRON_SECRET` automatically
when `CRON_SECRET` is set as an env var on the project. GitHub Actions / external cron
must send the **same** header. Accept that one scheme everywhere:

```ts
// same file (or extract to lib/auth.ts and import)
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if the secret isn't configured

  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}
```

Notes:
- **Fail closed.** If `CRON_SECRET` is unset, return 401 — never run an unauthenticated scrape.
- For constant-time comparison (defense against timing attacks) you can use
  `crypto.timingSafeEqual`; for a long random hex secret a plain `===` is acceptable.
- Keep the endpoint `POST`-only. A scrape mutates the DB — don't expose it as a cacheable `GET`.

---

## Option A — Vercel Cron (`vercel.json` at repo root)

Vercel only allows a **GET** for the cron trigger path. Two clean ways to reconcile
that with a mutating `POST` handler:

1. Add a sibling `GET` in `app/api/refresh/route.ts` that does the same auth + work
   (simplest), **or**
2. Point the cron at a thin `app/api/cron/route.ts` `GET` that forwards to the refresh logic.

`vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/refresh",
      "schedule": "0 5 * * *"
    }
  ]
}
```

- `schedule` is standard cron in **UTC**. `0 5 * * *` = 05:00 UTC daily ≈ **01:00
  America/Toronto** (EDT) — a low-traffic nightly slot for the GTA audience.
- **Hobby/Free tier: at most one run per day per cron** and the minute is best-effort.
  `0 5 * * *` is daily, so it's within the free limit.
- Set `CRON_SECRET` in **Project Settings -> Environment Variables**. Vercel then
  injects `Authorization: Bearer <CRON_SECRET>` into the cron request automatically —
  the `isAuthorized` check above passes with no extra config.

Add the matching `GET` so Vercel's GET trigger reaches the same code:

```ts
// app/api/refresh/route.ts  (append)
export async function GET(request: NextRequest) {
  return POST(request); // reuse auth + pipeline + revalidation
}
```

---

## Option B — GitHub Actions scheduled workflow

Use when not on Vercel, or you want the scrape's logs/retries in CI. The workflow
`curl`s the deployed endpoint with the secret. Store the secret and the deploy URL as
**repo secrets** (Settings -> Secrets and variables -> Actions): `CRON_SECRET`,
`REFRESH_URL` (e.g. `https://northbound.example.com/api/refresh`).

```yaml
# .github/workflows/nightly-refresh.yml
name: Nightly event refresh

on:
  schedule:
    - cron: '0 5 * * *' # 05:00 UTC daily (~01:00 America/Toronto, EDT)
  workflow_dispatch: {}    # allow manual runs from the Actions tab

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Trigger POST /api/refresh
        run: |
          code=$(curl -sS -X POST "$REFRESH_URL" \
            -H "Authorization: Bearer $CRON_SECRET" \
            -H "Content-Type: application/json" \
            --retry 3 --retry-delay 30 --max-time 300 \
            -o /tmp/body.json -w '%{http_code}')
          echo "HTTP $code"
          cat /tmp/body.json
          test "$code" = "200"
        env:
          REFRESH_URL: ${{ secrets.REFRESH_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

- GH cron is also **UTC** and can fire several minutes late under load — fine for nightly.
- `--retry 3` covers transient cold-start/network blips; `test "$code" = "200"` fails the
  job (and emails you) on any non-200, giving you free alerting.
- `workflow_dispatch` lets you trigger a manual refresh without touching the DB by hand.

---

## Option C — External cron (cron-job.org / Upstash QStash)

If you want timing guarantees + retries independent of the host: configure a job that
sends `POST https://<domain>/api/refresh` with header
`Authorization: Bearer <CRON_SECRET>`. Same endpoint, same auth — only the trigger differs.

---

## Cache invalidation — making the new events show up

The refresh writes to MongoDB, but the feed page/route may be serving a cached render.
Invalidate **after** the upsert completes (already wired in the handler above). Two
mechanisms, depending on how the feed is cached:

### 1) Tag-based (preferred for the feed) — `revalidateTag('events', 'max')`

Tag the cached events data wherever it's read, then bust that tag on refresh.

```ts
// when reading the feed (Server Component or a 'use cache' helper)
// fetch variant:
const res = await fetch(`${base}/api/events`, { next: { tags: ['events'] } });

// or a cached DB helper:
import { cacheTag } from 'next/cache';
async function getEvents() {
  'use cache';
  cacheTag('events');
  // ...Event.find(...).lean()
}
```

```ts
// in POST /api/refresh, after the upsert:
revalidateTag('events', 'max'); // v16: SECOND ARG REQUIRED.
```

- The **two-arg** form is mandatory in Next 16 — `revalidateTag('events')` is deprecated
  and errors under TypeScript. `'max'` gives stale-while-revalidate: tagged data is
  marked stale and refreshed on the next visit (no thundering-herd of revalidations).
- Tag everything that reads events with the **same** `'events'` tag so one call covers
  the home feed, search results, and any per-source widgets.

### 2) Path-based — `revalidatePath('/')`

If the home feed isn't tagged (e.g. it just renders a Server Component that queries
Mongo directly), invalidate by route path instead:

```ts
revalidatePath('/');                 // literal path -> omit the type arg
// revalidatePath('/events/[slug]', 'page'); // dynamic pattern -> 'page' arg REQUIRED
```

- Use a **literal** path with no `type` for `/`. For a **dynamic** route pattern like
  `/events/[slug]` the `type` arg (`'page'`/`'layout'`) is required.
- **Rewrites caveat:** `revalidatePath` operates on the route-file structure, not the
  browser URL. The PostHog `/ingest/*` rewrites in `next.config.ts` don't affect feed
  paths, but if you ever rewrite the feed, pass the **destination** path here.

Calling both `revalidateTag('events','max')` and `revalidatePath('/')` is fine and
belt-and-suspenders: the tag covers tagged data anywhere; the path refresh covers a
directly-querying feed page.

---

## Verify it end to end

```bash
# Generate a secret (store it in .env.local / Vercel env / GH secrets — never commit)
openssl rand -hex 32

# Local manual trigger against the dev server
curl -i -X POST http://localhost:3000/api/refresh \
  -H "Authorization: Bearer $CRON_SECRET"

# Expect: 200 { "ok": true, "upserted": N, "modified": M, ... }
# Without the header -> 401 Unauthorized (confirms fail-closed auth)
```

Checklist:
1. `CRON_SECRET` set in every place that triggers (Vercel env / GH `secrets.CRON_SECRET`).
2. `POST /api/refresh` returns 200 with the secret, 401 without it.
3. After a run, the feed shows freshly scraped events (tag/path revalidation fired).
4. `export const runtime = 'nodejs'` is present — Mongoose can't run on Edge.
5. Schedule is in **UTC**; `0 5 * * *` ≈ 01:00 Toronto. Adjust for DST if exact local
   time matters (UTC offset shifts between EST/EDT).
