---
name: northbound-build-and-env
description: Recreate, repair, or reason about the Northbound dev environment - clone/install/env setup, the MONGODB_URI "test"-database trap (app runs but shows ZERO events), the full env-var catalog with exact consumers, direnv/.envrc bootstrap, .mcp.json MCP servers, Tailwind v4/ESLint 9/tsconfig toolchain facts, WSL no-Chrome reality, and what "validation green" actually means here (tsc passes, npm run lint is red by baseline). Load for - fresh clone setup, empty homepage after connecting, "which Node version", missing env var errors, "where is tailwind.config", lint exits 1, MCP server won't start.
---

# Northbound: build and environment

Northbound = an event-aggregator web app (Next.js 16.2.6 App Router, React 19, TypeScript 5,
Tailwind v4, MongoDB Atlas via Mongoose 9). Repo dir is `events_site`; git remote is
`https://github.com/CodeOfGordon/northbound.dev.git`. This skill gets you from nothing to a
working dev environment and catalogs every env var. Running scrapes, the cron, and deploys
are `northbound-run-and-operate` territory.

## Prerequisites

| Need | Constraint | Evidence |
|---|---|---|
| Node.js | **>= 20.9.0** — there is NO `engines` field in package.json and NO `.nvmrc`; the binding constraint is Next 16.2.6's own engines | `node_modules/next/package.json` engines |
| npm | lockfile is `package-lock.json` (npm, not pnpm/yarn) | repo root |
| git + `gh` CLI | `gh` only for workflow/secret ops (see `northbound-run-and-operate`) | `/usr/bin/gh` on dev box |
| direnv | optional shell-env bootstrap (see below); 2.25.2 on dev box | `/usr/bin/direnv` |
| uv (`uvx`) | ONLY for the `fetch` MCP server | `.mcp.json` fetch entry |

Dev box as of 2026-07-20: Node v22.22.2, npm 10.9.7, WSL2 (Linux).

## Setup from scratch

```bash
git clone https://github.com/CodeOfGordon/northbound.dev.git
cd northbound.dev
npm install
cp .env.example .env.local
# EDIT .env.local — read "THE DB-PATH TRAP" below BEFORE filling MONGODB_URI.
# Dev minimum: MONGODB_URI + CRON_SECRET. Everything else is optional (see table).
npm run dev          # http://localhost:3000
```

Success check: the homepage renders event cards (473 events in prod DB as of 2026-07-20).
**If the app runs cleanly but shows ZERO events everywhere, you hit the DB-path trap below.**

Optional but recommended — recreate `.envrc` for direnv (it will NOT exist in a fresh clone,
see the direnv section):

```bash
printf '# Loads .env.local into the shell when you cd into this project (via direnv).\n# Contains NO secrets itself — only references the gitignored .env.local.\n# direnv will not load this until you run `direnv allow` once.\ndotenv .env.local\n' > .envrc
direnv allow
```

## THE DB-PATH TRAP (read before filling MONGODB_URI)

`.env.example` line 8 shows a URI template ending in `/events_site`:

```
MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/events_site
```

**That path is wrong for the real data.** ALL production data lives in the database named
**`test`**. The real URIs carry NO database path, so Mongoose falls back to its default db
`test`. Live-verified against the Atlas cluster 2026-07-20:

- Databases on the cluster: `sample_mflix`, `test`, `admin`, `local` — there is **no
  `events_site` database at all**.
- `test` holds exactly 3 collections: `events` (473 docs), `bookings` (0), `meta` (1).

Consequences:

- Connecting with `/events_site` in the path "works" (Mongo creates dbs lazily) and yields a
  perfectly functional, **completely empty** app. Much confusion follows.
- Fix: strip the path — end the URI at `.mongodb.net/` (or write `/test` explicitly).
- Do NOT "fix" it the other way (migrating data into `events_site`): the live cluster IS
  production (no staging), writes outside the scrape pipeline need explicit approval from
  gordon, and the deployed app + cron point at `test`. See `northbound-change-control` (G2).

One-line drift check (read-only; run from repo root with MONGODB_URI in the shell):

```bash
node -e 'require("mongoose").createConnection(process.env.MONGODB_URI).asPromise().then(async c=>{console.log("db:",c.name,"events:",await c.db.collection("events").countDocuments());process.exit(0)})'
```

Expected: `db: test events: <hundreds>`. If `db:` prints `events_site`, your URI has the bad path.

## Env-var catalog (complete, as of 2026-07-20)

Every `process.env` read in app code (`app/ components/ lib/ database/ instrumentation-client.ts
next.config.ts`) is listed. Grep-verified: there are exactly 7 consumer sites.

| Var | Consumer (file + identifier) | Required when | Notes |
|---|---|---|---|
| `MONGODB_URI` | `database/mongodb.ts` → `const MONGODB_URI`, used by `connectDB()` | Any page/API touching the DB — practically always | Throws `'MongoDB URI does not exist in env file'` at connect time, not at boot. **See DB-path trap.** |
| `CRON_SECRET` | `app/api/refresh/route.ts` → `const secret = process.env.CRON_SECRET` | Triggering scrapes (`POST /api/refresh`) | Fail-closed: 401 when unset. Any long random string works in dev. |
| `SCRAPE_MAX_ITEMS` | `lib/fetchers/config.ts` → `MAX_ITEMS` | Optional | Default 50, clamped >= 1. Per-source scrape cap; the Apify billing cap rides on it (see `northbound-pipeline-engineering`). |
| `APIFY_TOKEN` | `lib/fetchers/apify.ts` → `headers()` (throws `'APIFY_TOKEN is not set'`); also `.mcp.json` apify server | ONLY when running paid sources `eventbrite`/`meetup`, or the apify MCP | **G1: Apify runs cost money — need gordon's approval first.** Free sources never touch it. |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | `instrumentation-client.ts` → `posthog.init(...!)` | Optional in dev | Non-null-asserted; client analytics only. |
| `NEXT_PUBLIC_POSTHOG_HOST` | **NOTHING — dead var** | Never | In `.env.example` (with a misleading "already wired" comment) but read by zero code: `instrumentation-client.ts` hardcodes `api_host: "/ingest"` + `ui_host: "https://us.posthog.com"`; `next.config.ts` rewrites `/ingest/*`. Safe to leave blank. |
| `NEXT_PUBLIC_SITE_URL` | `app/layout.tsx` → `const SITE_URL`, feeds `metadataBase` | Deploy-time correctness of canonical/OG URLs | **ABSENT from `.env.example`.** Silent fallback `https://northbound.vercel.app` — which may NOT match the linked Vercel project `northbound-dev` (`.vercel/project.json`). Open question as of 2026-07-20; canonical-host decision belongs to `northbound-run-and-operate`. |
| `NODE_ENV` | `instrumentation-client.ts` → PostHog `debug` flag | Never set manually | Next.js sets it. |
| `MDB_MCP_CONNECTION_STRING` | `.mcp.json` mongodb MCP server ONLY | Using the mongodb MCP | **No app code reads it** (grep-proven). Same value as MONGODB_URI; same DB-path trap applies. |
| `BRAVE_API_KEY` | `.mcp.json` brave-search MCP server ONLY | Using the brave-search MCP | No app code reads it. |

Dev minimum: `MONGODB_URI` + `CRON_SECRET`. `.env.local` on the dev box defines 8 vars
(the `.env.example` set); `NEXT_PUBLIC_SITE_URL` is absent there too.

## direnv bootstrap (and its trap)

`.envrc` is one functional line — `dotenv .env.local` — plus comments; it holds no secrets.
It needs a one-time `direnv allow`. Why you want it: **`.env.local` is loaded by Next.js,
not by your shell** — `.mcp.json` interpolates `${MDB_MCP_CONNECTION_STRING}` etc. from the
*shell* environment, and ad-hoc `curl`/`node` commands need `$CRON_SECRET`/`$MONGODB_URI` in
the shell. direnv bridges that gap on `cd`.

**TRAP:** `.gitignore` line 34 is `.env*`, which swallows `.envrc` (only `.env.example` is
re-included via `!.env.example`). Verified: `git check-ignore -v .envrc` →
`.gitignore:34:.env*`. **A fresh clone has no `.envrc`** — recreate it with the `printf`
command in the setup section. (Whether to un-gitignore it is an open question; route through
`northbound-change-control`.)

## Toolchain facts (things that look wrong but are correct)

| Fact | Detail | Evidence |
|---|---|---|
| Path alias | `@/*` → **repo root** (not `src/`; there is no `src/`) | `tsconfig.json` `paths` |
| Tailwind v4, NO config file | Wired solely via `@tailwindcss/postcss` in `postcss.config.mjs`. Design tokens live in `app/globals.css` under `@theme inline`. **Do not create a `tailwind.config.*`** — token changes are G3 territory (`northbound-frontend-engineering`). | `postcss.config.mjs`; `app/globals.css` |
| shadcn | `components.json`: style `radix-nova`, `rsc: true`, `tailwind.config: ""` (empty by design), css `app/globals.css`, lucide icons, extra registry `@react-bits` | `components.json` |
| ESLint 9 flat config | `eslint.config.mjs` = `eslint-config-next/core-web-vitals` + `/typescript`; `globalIgnores` covers ONLY `.next/**, out/**, build/**, next-env.d.ts` — so ESLint also lints `.claude/` scripts (see validation section) | `eslint.config.mjs` |
| npm scripts | exactly `dev` / `build` / `start` / `lint` (bare `eslint` — `next lint` was removed in Next 16). **No test script; no test suite exists.** | `package.json` scripts |
| TypeScript | strict, `noEmit`, `moduleResolution: bundler`, target ES2017 | `tsconfig.json` |
| `playwright` devDependency | NOT a test suite — zero imports in app code, no playwright.config. It exists only as a Chromium provider for agent tooling. | grep `from 'playwright'` → 0 hits |
| `ogl` dependency | Installed but zero imports (leftover from removed LightRays background) — do not assume it is used | `package.json`; grep |

## MCP servers (`.mcp.json` — agent tooling, not the app)

All secrets enter via `${VAR}` interpolation **from the shell env** (hence direnv).

| Server | Command | Env | Notes |
|---|---|---|---|
| mongodb | `npx -y mongodb-mcp-server@latest --readOnly` | `MDB_MCP_CONNECTION_STRING` | **`--readOnly` is a hard rule (G2) — never remove it.** |
| apify | `npx -y @apify/actors-mcp-server --tools actors,docs` | `APIFY_TOKEN` | Actor runs COST MONEY (G1). Details in `northbound-run-and-operate`. |
| playwright | `npx -y @playwright/mcp@latest --headless --isolated` | — | Uses Playwright's bundled Chromium (below). |
| fetch | `uvx mcp-server-fetch` | — | Needs uv installed (`uvx` on PATH). |
| brave-search | `npx -y @brave/brave-search-mcp-server --transport stdio` | `BRAVE_API_KEY` | Free tier ~2k queries/mo per `.env.example` comment. |

## WSL reality: no Chrome

The dev box is WSL2 with **no system Chrome/Chromium** (`which google-chrome chromium
chromium-browser` → nothing). Browser automation and screenshots use Playwright's bundled
Chromium (`~/.cache/ms-playwright/chromium-1223` as of 2026-07-20). On a fresh box:

```bash
npx playwright install chromium
```

Do not try to launch a chrome-devtools MCP against a system Chrome here — it will not find one.

## Validation reality (what "green" means here)

| Gate | Command | State as of 2026-07-20 | Interpretation |
|---|---|---|---|
| Type-check | `npx tsc --noEmit` | **exit 0, ~7s warm** (~10s cold measured 2026-07-19) | The real mechanical gate. Run it before claiming a change is done. |
| Lint | `npm run lint` | **exit 1** — 136 problems: 1 error + 135 warnings | See baseline below. Exit 1 is the KNOWN baseline, not proof you broke something. |
| Build | `npm run build` | Not run locally as a gate | Vercel builds on deploy. Next 16's `next build` no longer runs ESLint (grep `runLintCheck` in `node_modules/next/dist/build/index.js` → 0 hits). |
| Tests | — | **None exist** | No test files, no jest/vitest/playwright configs. Adding tests is a candidate tracked in `northbound-validation-and-qa`. |

Lint baseline decoded (re-verified 2026-07-20):

- The **1 error**: `react-hooks/purity` — `Date.now()` called during render at
  `components/FreshnessBadge.tsx:19`. Known open issue.
- The **~135 warnings** are largely ESLint reaching into the *untracked*
  `.claude/skills/impeccable/` scripts, because `eslint.config.mjs` ignores only
  `.next/out/build/next-env.d.ts`. On a fresh clone (which lacks those untracked files) the
  warning count will be far lower.
- Practical rule: after a change, only NEW errors/warnings **in files you touched** are
  signal. Fixing FreshnessBadge or adding `.claude/**` to `globalIgnores` are real
  improvements — but route any lint-config change through `northbound-change-control`.

## Fresh-clone gaps (files the remote does not have)

As of 2026-07-20 (`git status --porcelain`), these exist locally but are **untracked** —
a fresh clone will NOT have them until someone commits them:

- `DESIGN.md`, `PRODUCT.md` — **these are law for UI work (G3)**; if your clone lacks them,
  that is why — flag it rather than proceeding without them.
- `.impeccable/`, `.claude/skills/impeccable/`, `skills-lock.json` — agent tooling.

Also absent from any clone (gitignored): `.env.local` (create from template), `.envrc`
(recreate — see direnv trap), `.vercel/` (Vercel project link `northbound-dev`,
projectId `prj_du0T1fsIlf8tU6yfHeqFfsNTXxFp`; re-linking/deploy belongs to
`northbound-run-and-operate`).

Re-verify the untracked set anytime with `git status --porcelain`.

## When NOT to use this skill

- **Running the app, triggering scrapes, the GitHub Actions cron, deploys, prod-DB
  etiquette, paid-source protocol** → `northbound-run-and-operate`.
- **Changing scrapers, normalization, schema, dedup, or `lib/fetchers/config.ts`** →
  `northbound-pipeline-engineering`.
- **UI/pages/API-surface work, design-token or Tailwind changes** →
  `northbound-frontend-engineering` (PRODUCT.md/DESIGN.md compliance lives there).
- **A symptom you can't yet localize** (scrape failing, wrong dates, empty lanes) →
  `northbound-debugging-playbook`; past investigations → `northbound-failure-archaeology`.
- **Measuring DB/source health** → `northbound-diagnostics-and-tooling`.
- **Whether a change is allowed at all / the four hard gates in full** →
  `northbound-change-control`.
- **What counts as verified/tested** → `northbound-validation-and-qa`.
- **Load-bearing architecture decisions** (why Mongoose 9, why no staging) →
  `northbound-architecture-contract`.

## Provenance and maintenance

Authored 2026-07-20 from repo state + verified commands: every config quoted above was read
directly (`.env.example`, `.envrc`, `.gitignore`, `package.json`, `tsconfig.json`,
`eslint.config.mjs`, `postcss.config.mjs`, `components.json`, `.mcp.json`,
`instrumentation-client.ts`); `tsc`/`lint` were executed; DB contents were re-measured live
via the read-only MongoDB MCP on 2026-07-20.

Volatile facts and their one-line drift checks:

| Volatile fact | Re-verification command |
|---|---|
| Node floor is Next's engines (>=20.9.0), no repo pin | `node -e "console.log(require('./node_modules/next/package.json').engines)" && ls .nvmrc` |
| `npx tsc --noEmit` is green | `npx tsc --noEmit; echo exit=$?` |
| `npm run lint` exits 1 (1 error in FreshnessBadge.tsx) | `npm run lint 2>&1 \| tail -3; echo exit=$?` |
| Exactly 7 `process.env` consumer sites in app code | `grep -rn "process.env" --include="*.ts" --include="*.tsx" app components lib database instrumentation-client.ts next.config.ts` |
| `NEXT_PUBLIC_POSTHOG_HOST` is dead | `grep -rn NEXT_PUBLIC_POSTHOG_HOST app components lib database instrumentation-client.ts next.config.ts; echo exit=$?` (expect exit=1) |
| `NEXT_PUBLIC_SITE_URL` absent from `.env.example` | `grep -c NEXT_PUBLIC_SITE_URL .env.example; echo exit=$?` (expect 0 / exit=1) |
| `.envrc` swallowed by gitignore | `git check-ignore -v .envrc` (expect `.gitignore:34:.env*`) |
| Prod data lives in db `test` (473 events) | `node -e 'require("mongoose").createConnection(process.env.MONGODB_URI).asPromise().then(async c=>{console.log(c.name,await c.db.collection("events").countDocuments());process.exit(0)})'` |
| Untracked-file set (DESIGN.md, PRODUCT.md, ...) | `git status --porcelain` |
| No tailwind.config exists | `ls tailwind.config.* 2>/dev/null; echo exit=$?` (expect exit != 0) |
| Next build still skips ESLint | `grep -c runLintCheck node_modules/next/dist/build/index.js` (expect 0) |
| Bundled Chromium present, no system Chrome | `ls ~/.cache/ms-playwright \| head -3; which google-chrome chromium chromium-browser` |
| MCP server set unchanged (5 servers, mongodb `--readOnly`) | `node -e "console.log(Object.keys(require('./.mcp.json').mcpServers).join(','), require('./.mcp.json').mcpServers.mongodb.args.join(' '))"` |
