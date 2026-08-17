/**
 * luma-funnel.mjs — READ-ONLY probe of the Luma local-coverage funnel.
 * Phase 1a instrument of the northbound-coverage-campaign skill.
 *
 * For every slug in LUMA_CITY_SLUGS (lib/fetchers/config.ts) it resolves the slug
 * via api.lu.ma/url exactly like lib/fetchers/luma.ts fetchLumaEntries, pulls the
 * feed, and prints:  feed size -> upcoming -> relevance-pass, plus a sample of
 * upcoming events the isRelevant() gate DROPS. That last list is the campaign's
 * false-negative audit: real tech events appearing there mean the INCLUDE regex
 * in lib/fetchers/relevance.ts is starving the Local lane.
 *
 * Run from the repo root (no env needed — network only, no DB):
 *   node .claude/skills/northbound-coverage-campaign/scripts/luma-funnel.mjs
 *
 * isRelevant and LUMA_CITY_SLUGS are imported LIVE from the pipeline source via
 * Node's native TypeScript type-stripping (works on Node >= 22.18; repo toolchain
 * is v22.22.2). If the import fails, the script aborts rather than silently
 * using a stale replica — fix the import path before trusting any numbers.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { isRelevant } = await import(path.join(REPO_ROOT, 'lib/fetchers/relevance.ts'));
const { LUMA_CITY_SLUGS } = await import(path.join(REPO_ROOT, 'lib/fetchers/config.ts'));

// Same default identity as lib/fetchers/util.ts getJSON.
const UA = 'NorthboundBot/1.0 (+https://github.com/CodeOfGordon)';
const API = 'https://api.lu.ma';

async function getJSON(url) {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
    return r.json();
}

function report(name, entries) {
    const valid = (entries ?? []).filter((e) => e?.event?.name && e.event.start_at);
    const now = Date.now();
    const upcoming = valid.filter((e) => new Date(e.event.start_at).getTime() >= now);
    // Mirrors fetchLuma's gate: isRelevant(`${raw.name} ${raw.calendar?.name ?? ''}`)
    const pass = upcoming.filter((e) => isRelevant(`${e.event.name} ${e.calendar?.name ?? ''}`));
    console.log(`${name}: feed=${valid.length}  upcoming=${upcoming.length}  relevance-pass=${pass.length}`);
    const dropped = upcoming.filter((e) => !pass.includes(e));
    for (const e of dropped.slice(0, 10)) {
        console.log(`  DROPPED: ${e.event.name}  [cal: ${e.calendar?.name ?? '—'}]`);
    }
    if (dropped.length > 10) console.log(`  ... and ${dropped.length - 10} more dropped`);
    return { feed: valid.length, upcoming: upcoming.length, pass: pass.length };
}

let totalPass = 0;
for (const slug of LUMA_CITY_SLUGS) {
    try {
        const resolved = await getJSON(`${API}/url?url=${encodeURIComponent(slug)}`);
        let entries = [];
        if (resolved.kind === 'discover-place') {
            ({ entries } = await getJSON(
                `${API}/discover/get-paginated-events?discover_place_api_id=${resolved.data.place.api_id}&pagination_limit=50`,
            ));
        } else if (resolved.kind === 'calendar') {
            // e.g. 'ottawa' resolves to a community calendar, not a discover place (as of 2026-07-20)
            ({ entries } = await getJSON(
                `${API}/calendar/get-items?calendar_api_id=${resolved.data.calendar.api_id}&period=future&pagination_limit=50`,
            ));
        } else {
            console.log(`${slug}: resolved to unsupported kind "${resolved.kind}" — fetchLuma would skip it`);
            continue;
        }
        totalPass += report(`${slug} (${resolved.kind})`, entries).pass;
    } catch (e) {
        console.log(`${slug}: ${e.message} — fetchLuma would skip this slug with a warning`);
    }
    await new Promise((r) => setTimeout(r, 500));
}
console.log(`\nTOTAL relevance-pass across city slugs: ${totalPass}`);
console.log('(This is the pool fetchLuma feeds into normalize/upsert — the Local lane luma supply.)');
