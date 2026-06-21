# Scheduled scrape — setup & troubleshooting

The nightly/weekly scrape is a GitHub Actions workflow (`.github/workflows/scrape.yml`)
that calls `POST /api/refresh` on the **deployed** site. The site does the actual
scraping (it has the MongoDB connection + Apify token); the workflow is just a timer
that pings it.

```
GitHub Actions cron ──POST /api/refresh──▶ deployed app ──▶ scrapers ──▶ MongoDB
```

## Why it was failing

The workflow needs two repository secrets, **`SITE_URL`** and **`CRON_SECRET`**.
They were never set, so every scheduled run did `curl` against an empty URL and
exited non-zero within a few seconds (the ~6–9 s "failure" runs in the Actions tab).

The workflow now **skips with a warning** instead of failing when those secrets are
missing, so the Actions tab stops showing red ✗ until it's wired up. A manual run
(`workflow_dispatch`) still errors, so you get clear feedback while configuring it.

## One-time setup

1. **Deploy the app** (Vercel + MongoDB Atlas). Set the env vars from `.env.example`
   on the deployment — at minimum `MONGODB_URI`, `CRON_SECRET`, and `APIFY_TOKEN`
   (only needed for the paid Eventbrite/Meetup sources).

2. **Add the two repo secrets** — Settings → Secrets and variables → Actions →
   *New repository secret*:

   | Secret | Value |
   |---|---|
   | `SITE_URL` | Deployed base URL, no trailing slash — e.g. `https://northbound.vercel.app` |
   | `CRON_SECRET` | The **same** value as `CRON_SECRET` on the deployment |

   You can also set them from the CLI:
   ```bash
   gh secret set SITE_URL --body "https://your-app.vercel.app"
   gh secret set CRON_SECRET --body "your-cron-secret"
   ```

3. **Test it** — Actions → *Scrape events* → *Run workflow*. With the secrets set it
   will POST one request per source and report per-source success in the log.

## Verifying locally

```bash
curl -X POST http://localhost:3000/api/refresh \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sources":["luma","mlh","hackathon","company"]}'
```

A `200` with `{ ok: true, upserted, modified, ranAt }` means it worked. The `ranAt`
timestamp also drives the **"Updated X ago"** indicator in the site footer/hero
(stored in the `meta` collection by the refresh route).

## Schedule

- **Nightly ~03:15 ET** — free sources: `luma mlh hackathon company`
- **Weekly, Sunday ~03:45 ET** — paid Apify sources: `eventbrite meetup`

Each source is POSTed separately so one slow source can't starve the rest and each
stays inside the route's 300 s ceiling.

## Alternative: run the scrape inside the Action (no deployment needed)

If you'd rather not depend on a deployed site, the workflow could instead check out
the repo, `npm ci`, and run the pipeline directly against MongoDB. That removes the
`SITE_URL` dependency but moves `MONGODB_URI` (+ `APIFY_TOKEN`) into GitHub secrets
and builds the project in CI. The current ping-the-deployment model keeps database
credentials only on the host that needs them, which is why it's the default.
