/**
 * coverage-report.mjs — upcoming events per lane and per city, next 30 days.
 * READ-ONLY. The coverage campaign's primary metric.
 *
 * Run from the repo root:
 *   node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/coverage-report.mjs
 *
 * Lane derivation imports laneOf() LIVE from lib/constants.ts via Node's native
 * TypeScript type-stripping (works on Node >= 22.18; verified on v22.22.2).
 * If that import ever fails (older Node, moved file), the script falls back to
 * a replica of laneOf and prints a loud DRIFT WARNING — re-verify the replica
 * against lib/constants.ts laneOf() before trusting lane numbers.
 */
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let laneOf;
try {
    ({ laneOf } = await import(path.join(REPO_ROOT, 'lib/constants.ts')));
} catch {
    console.error('DRIFT WARNING: could not import lib/constants.ts — using a replica of laneOf().');
    console.error('Re-verify against lib/constants.ts before trusting lane numbers.\n');
    laneOf = (source, category) => {
        if (source === 'company') return 'company';
        if (source === 'mlh' || source === 'hackathon' || category === 'hackathon') return 'hackathon';
        return 'local';
    };
}

/** Same derivation as todayInToronto() in lib/events.ts. */
function todayInToronto() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

/** today + n days as YYYY-MM-DD (UTC-noon arithmetic avoids DST edges). */
function plusDays(ymd, n) {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function pad(s, n) { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set — run with node --env-file=.env.local');
    await mongoose.connect(uri, { bufferCommands: false, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db;

    const from = todayInToronto();
    const to = plusDays(from, 30);
    const docs = await db.collection('events')
        .find({ date: { $gte: from, $lte: to } }, { projection: { source: 1, category: 1, city: 1, region: 1, mode: 1 } })
        .toArray();

    const LANES = ['company', 'hackathon', 'local'];
    const laneTotals = { company: 0, hackathon: 0, local: 0 };
    const cities = new Map(); // city -> { total, company, hackathon, local }
    for (const d of docs) {
        const lane = laneOf(d.source, d.category);
        laneTotals[lane] += 1;
        const city = d.city || '(none)';
        if (!cities.has(city)) cities.set(city, { total: 0, company: 0, hackathon: 0, local: 0 });
        const c = cities.get(city);
        c.total += 1; c[lane] += 1;
    }

    console.log(`db: ${db.databaseName}   window: ${from} .. ${to} (next 30 days, Toronto-local today)\n`);
    console.log('PER LANE');
    for (const l of LANES) console.log(`  ${pad(l, 10)}${rpad(laneTotals[l], 5)}`);
    console.log(`  ${pad('TOTAL', 10)}${rpad(docs.length, 5)}\n`);

    console.log(`PER CITY${' '.repeat(12)}${rpad('TOTAL', 6)}${rpad('company', 9)}${rpad('hackathon', 11)}${rpad('local', 7)}`);
    const sorted = [...cities.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
    for (const [city, c] of sorted) {
        console.log(`  ${pad(city, 18)}${rpad(c.total, 6)}${rpad(c.company, 9)}${rpad(c.hackathon, 11)}${rpad(c.local, 7)}`);
    }

    await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
