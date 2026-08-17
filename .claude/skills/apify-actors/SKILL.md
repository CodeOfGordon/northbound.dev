---
name: apify-actors
description: RETIRED 2026-07-20 — do not use. This pre-implementation skill documents a Luma actor the project no longer uses and input shapes that don't match the code. Load northbound-pipeline-engineering (Apify invocation runbook with billing gates) and northbound-source-platforms-reference (actor model, run options vs inputs) instead.
---

# RETIRED — do not follow this skill

Known-wrong content it used to carry: a Luma Apify actor (superseded by the free
direct `api.lu.ma` API, ADR-009) and Eventbrite input examples
(`'city':'toronto--ontario'`) that don't match the implemented
`canada--toronto`-style slugs in `lib/fetchers/config.ts`.

**Use instead:**

- `northbound-pipeline-engineering` — the billing-hardened `runActor` runbook (G1: run-option `?maxItems=` always; approval before any paid run).
- `northbound-source-platforms-reference` — the Apify actor model and the real eventbrite/meetup actor facts.

Original content recoverable via `git log -- .claude/skills/apify-actors/`.
