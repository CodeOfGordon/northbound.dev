# Northbound coverage campaign — log

Append-only, newest last. Convention: see "Campaign log convention" in SKILL.md.
Read this file FIRST before doing any campaign work; append your results when done.

## 2026-07-20 — Phase 0 baseline (campaign opened)

- Phase: 0 | Measurement: opening baseline, all read-only (source-health.mjs, coverage-report.mjs, luma-funnel.mjs, devpost-local-gap.mjs, api.lu.ma slug/calendar probes, per-organizer aggregate).
- Command(s):
  - `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs`
  - `node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/coverage-report.mjs`
  - `node .claude/skills/northbound-coverage-campaign/scripts/luma-funnel.mjs`
  - `node .claude/skills/northbound-coverage-campaign/scripts/devpost-local-gap.mjs`
- Observed:
  - Per source (docs / upcoming, newest updatedAt): luma 33/5 (2026-07-19), eventbrite 29/5 (2026-06-10 — aging out), meetup 0/0 (never), mlh 17/11, company 255/96, hackathon 139/5. Total 473/122.
  - Nightly cron: live and green — meta perSource luma/mlh/hackathon/company all 2026-07-19T09:15Z, lastErrors [].
  - 30-day lanes (coverage-report): company 71, hackathon 7, local 5, total 83.
  - Local lane per city (30-day): Toronto 2, Montreal 2, Mississauga 1, Ottawa 0, Quebec City 0.
  - Local *tab* count (source-based, upcoming, unbounded): 10 — Toronto 4, Montreal 3, Ottawa 2, Mississauga 1, Quebec City 0 (2 luma docs are category:'hackathon' → hackathon lane in reports).
  - All-lane upcoming in the 5 target cities: 26 (company 12, eventbrite 5, luma 5, mlh 4).
  - Luma funnel: toronto feed 39 → relevance-pass 8; montreal 26 → 2; ottawa slug resolves to calendar "Ottawa AI and Tech Community" with 0 future entries. Clear tech events in the DROPPED lists ("OpenMTL - Personal Agents", "Bitcoin Devleoper Conference - btcplusplus", "Solana & Superteam Canada Mixer", DotDev events).
  - Luma city-slug expansion probed and FENCED: quebec-city/mississauga/markham/richmond-hill 404; brampton/oakville/quebec/waterloo squatted (kind=event); vaughan 301.
  - Company registry: 38 entries; zero-docs-ever = Tesla (expected, devOnly gate), Cohere, Hugging Face, Vercel, Perplexity, ElevenLabs, Linear, Notion Toronto. Calendar probes for Cohere/Vercel/Hugging Face/Linear/Cloudflare: 0 future entries each → quiet orgs, not dead adapters. Watch item: Google bespoke adapter (1 doc ever, 0 upcoming, last touched 2026-06-24).
  - Devpost in-person ON/QC gap: 2 of 75 ("GenZ Can Hack 2026" fails 120-day span gate at 143d; "Stupid Ideas Hackathon (Ottawa F26)" single-date → parseDevpostRange returns null → skipped). Single-date skip also affects the online slice.
- Metric: **5** (this IS the baseline).
- Next: Phase 1a is the highest-yield free lever (relevance INCLUDE false negatives, measured). Phase 2 route 1 (community Luma calendars, esp. Ottawa) needs the lane-routing decision first. No paid runs proposed.
