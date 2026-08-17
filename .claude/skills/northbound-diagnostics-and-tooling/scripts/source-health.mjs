/**
 * source-health.mjs — per-source health snapshot of the Northbound events DB.
 * READ-ONLY. The standard before/after instrument for any pipeline change.
 *
 * Run from the repo root:
 *   node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/source-health.mjs
 *
 * Prints: per-source doc counts, upcoming/past split (date >= today in
 * America/Toronto, matching lib/events.ts todayInToronto), newest updatedAt
 * per source, and the ScrapeMeta singleton (key:'scrape' in the `meta`
 * collection) — lastRunAt, perSource timestamps, lastErrors.
 */
import mongoose from 'mongoose';

// The 6-value source enum — mirrors database/event.model.ts `source` field.
// If the enum changes there, update this list (drift check: grep "enum: \['luma'" database/event.model.ts)
const SOURCES = ['luma', 'eventbrite', 'meetup', 'mlh', 'company', 'hackathon'];

/** Same derivation as todayInToronto() in lib/events.ts. */
function todayInToronto() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

function pad(s, n) { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set — run with node --env-file=.env.local');
    // Connect exactly as the app does (database/mongodb.ts options; URI verbatim, no db-path assumptions)
    await mongoose.connect(uri, { bufferCommands: false, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db;
    const today = todayInToronto();

    const rows = await db.collection('events').aggregate([
        { $group: {
            _id: '$source',
            docs: { $sum: 1 },
            upcoming: { $sum: { $cond: [{ $gte: ['$date', today] }, 1, 0] } },
            newest: { $max: '$updatedAt' },
        } },
    ]).toArray();
    const bySource = new Map(rows.map((r) => [r._id, r]));

    console.log(`db: ${db.databaseName}   today (America/Toronto): ${today}\n`);
    console.log(`${pad('SOURCE', 12)}${rpad('DOCS', 6)}${rpad('UPCOMING', 10)}${rpad('PAST', 6)}  NEWEST updatedAt (UTC)`);
    let total = 0, totalUp = 0;
    for (const s of SOURCES) {
        const r = bySource.get(s) ?? { docs: 0, upcoming: 0, newest: null };
        total += r.docs; totalUp += r.upcoming;
        const newest = r.newest ? new Date(r.newest).toISOString() : '—';
        console.log(`${pad(s, 12)}${rpad(r.docs, 6)}${rpad(r.upcoming, 10)}${rpad(r.docs - r.upcoming, 6)}  ${newest}`);
    }
    for (const r of rows) {
        if (!SOURCES.includes(r._id)) {
            console.log(`${pad(`?? ${r._id}`, 12)}${rpad(r.docs, 6)}  UNEXPECTED SOURCE VALUE (not in the model enum)`);
            total += r.docs;
        }
    }
    console.log(`${pad('TOTAL', 12)}${rpad(total, 6)}${rpad(totalUp, 10)}${rpad(total - totalUp, 6)}\n`);

    const meta = await db.collection('meta').findOne({ key: 'scrape' });
    if (!meta) {
        console.log("meta singleton (key:'scrape'): MISSING — no scrape has recorded bookkeeping yet");
    } else {
        console.log("meta singleton (key:'scrape'):");
        console.log(`  lastRunAt:    ${meta.lastRunAt ? new Date(meta.lastRunAt).toISOString() : '—'}`);
        console.log(`  lastSources:  ${JSON.stringify(meta.lastSources ?? [])}   lastUpserted: ${meta.lastUpserted ?? 0}   lastModified: ${meta.lastModified ?? 0}`);
        const per = meta.perSource ?? {};
        const keys = Object.keys(per);
        console.log(`  perSource:    ${keys.length ? keys.map((k) => `${k}=${per[k]}`).join('\n                ') : '(empty)'}`);
        const errs = meta.lastErrors ?? [];
        console.log(`  lastErrors:   ${errs.length ? '' : '[] (clean)'}`);
        for (const e of errs) console.log(`    - ${e}`);
    }

    await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
