/**
 * devpost-local-gap.mjs — READ-ONLY probe of what the Devpost fetcher's
 * online-only slice is dropping locally. Phase 1c instrument of the
 * northbound-coverage-campaign skill.
 *
 * lib/fetchers/devpost.ts pulls only challenge_type[]=online (see its header
 * comment for why). This probe pulls the IN-PERSON slice instead and lists
 * open/upcoming hackathons located in Ontario/Quebec cities — i.e. legitimate
 * local hackathons Northbound currently does not ingest — and marks whether
 * each would survive the MAX_HACKATHON_DAYS span gate.
 *
 * Run from the repo root (network only, no DB):
 *   node .claude/skills/northbound-coverage-campaign/scripts/devpost-local-gap.mjs
 *
 * Imports MAX_HACKATHON_DAYS + parseDevpostRange + BROWSER_UA live from the
 * pipeline (Node >= 22.18 TS type-stripping; repo toolchain v22.22.2).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { MAX_HACKATHON_DAYS } = await import(path.join(REPO_ROOT, 'lib/fetchers/config.ts'));
const { parseDevpostRange, BROWSER_UA } = await import(
    path.join(REPO_ROOT, 'lib/fetchers/companies/shared.ts'),
);

const LOCAL = /toronto|ottawa|montreal|montréal|quebec|québec|mississauga|ontario|waterloo|kitchener/i;
const API = 'https://devpost.com/api/hackathons';

let total = 0;
const found = [];
for (let page = 1; page <= 3; page++) {
    const url =
        `${API}?challenge_type[]=in-person&status[]=open&status[]=upcoming` +
        `&order_by=deadline&per_page=30&page=${page}`;
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': BROWSER_UA } });
    if (!res.ok) {
        console.log(`page ${page} -> HTTP ${res.status} (Devpost blocks named AI-crawler UAs; BROWSER_UA should pass)`);
        break;
    }
    const j = await res.json();
    total = j.meta?.total_count ?? total;
    for (const h of j.hackathons ?? []) {
        const loc = h.displayed_location?.location ?? '';
        if (!LOCAL.test(loc)) continue;
        const dates = parseDevpostRange(String(h.submission_period_dates ?? ''));
        let span = '?';
        let verdict = 'span unparseable — fetcher would skip';
        if (dates) {
            span = Math.round((Date.parse(dates.end) - Date.parse(dates.start)) / 86_400_000);
            verdict = span > MAX_HACKATHON_DAYS
                ? `FAILS span gate (${span}d > MAX_HACKATHON_DAYS=${MAX_HACKATHON_DAYS})`
                : `would land (${span}d span)`;
        }
        found.push(`${h.title} | ${loc} | ${h.submission_period_dates} | ${verdict}`);
    }
    if (page * 30 >= total) break;
    await new Promise((r) => setTimeout(r, 600));
}
console.log(`Devpost in-person open/upcoming total_count: ${total}`);
console.log(`ON/QC in-person hackathons found: ${found.length}`);
for (const f of found) console.log(`  - ${f}`);
console.log('\nInterpretation: this is the expected yield of extending devpost.ts with an');
console.log('in-person-CA slice. Historically ~1-2 events (measured 2026-07-20) — small.');
