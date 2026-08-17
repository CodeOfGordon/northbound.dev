---
name: backend-api
description: RETIRED 2026-07-20 — do not use. This pre-implementation skill predates the as-built API routes and their known divergence from lib/events.ts. Load northbound-frontend-engineering (API routes as-built + divergence table) and northbound-architecture-contract (ADR-012: pages never fetch the HTTP API) instead.
---

# RETIRED — do not follow this skill

Known-wrong content it used to carry: `FilterQuery` sample types (removed in
Mongoose 9) and an API design that predates the real routes — which have since
diverged from `lib/events.ts` in six documented ways (a flagged open issue, not a
pattern to copy).

**Use instead:**

- `northbound-frontend-engineering` — the as-built routes, the divergence table, the raw-doc leak warning.
- `northbound-run-and-operate` — `POST /api/refresh` operation and auth.

Original content recoverable via `git log -- .claude/skills/backend-api/`.
