---
name: data-schema
description: RETIRED 2026-07-20 — do not use. This pre-implementation skill describes the Event schema extensions as a future "diff to propose" — they landed long ago, with differences (six source values incl. hackathon, a region field, fingerprint optional). Load northbound-pipeline-engineering (schema as-built) and northbound-architecture-contract (invariants) instead.
---

# RETIRED — do not follow this skill

Known-wrong content it used to carry: schema extensions framed as unapplied
proposals; a five-value `source` enum (real: six, incl. `hackathon`); no `region`
field; `fingerprint` required (real: optional, unique sparse); a
`{date:1,mode:1}` index that no longer exists.

**Use instead:**

- `northbound-pipeline-engineering` — the as-built schema, index set, and normalization rules.
- `northbound-architecture-contract` — the invariants (fingerprint recipe, slug-at-insert, string dates).

Original content recoverable via `git log -- .claude/skills/data-schema/`.
