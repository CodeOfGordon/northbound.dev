---
name: database
description: RETIRED 2026-07-20 — do not use. This pre-implementation skill carries stale hardening advice (a v8 import that no longer exists) and Mongoose FilterQuery types removed in v9. Load northbound-pipeline-engineering (models/queries as-built, Mongoose 9 deltas) and northbound-build-and-env (connection + the test-database trap) instead.
---

# RETIRED — do not follow this skill

Known-wrong content it used to carry: `FilterQuery<IEvent>` sample code (Mongoose
9 renamed it `QueryFilter` — copying the samples fails typecheck), advice to
remove a `cachedDataVersionTag` import that was already removed, and index
recommendations that have since been implemented differently.

**Use instead:**

- `northbound-pipeline-engineering` — models, indexes, and query patterns as-built.
- `northbound-build-and-env` — `connectDB()`, env vars, and the db-`test` trap.

Original content recoverable via `git log -- .claude/skills/database/`.
