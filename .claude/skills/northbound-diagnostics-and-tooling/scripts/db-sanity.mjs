/**
 * db-sanity.mjs — invariant gate for the Northbound events DB. READ-ONLY.
 * Exits non-zero when an invariant is violated, so it works as a gate before/after
 * pipeline or schema changes.
 *
 * Run from the repo root:
 *   node --env-file=.env.local .claude/skills/northbound-diagnostics-and-tooling/scripts/db-sanity.mjs
 *
 * Checks:
 *   1. Connected db name is 'test' (the app's MONGODB_URI has no db path, so
 *      Mongoose uses the default db — data does NOT live in 'events_site').
 *   2. Index inventory on `events` matches database/event.model.ts declarations
 *      (incl. unique/sparse flags). The expected table below is hand-mirrored from
 *      that file; the script greps the model source and warns if the table went stale.
 *   3. Zero docs with region 'INTL' (lib/scrape.ts drops INTL pre-upsert).
 *   4. Zero docs missing url or fingerprint.
 *   5. Slug near-misses: distinct fingerprints whose scraper slug basis
 *      generateSlug(`${title} ${date}`) collides — the silent-drop E11000 hole
 *      (two different events, same title+date, different cities).
 */
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// Hand-mirrored from database/event.model.ts (slug unique via field option; the
// rest via EventSchema.index calls). Key format: MongoDB index name.
const EXPECTED_INDEXES = {
    _id_: {},
    slug_1: { unique: true },
    fingerprint_1: { unique: true, sparse: true },
    mode_1_date_1: {},
    city_1_date_1: {},
    tags_1_date_1: {},
    region_1_date_1: {},
    date_1__id_1: {},
    title_text_description_text_tags_text: {}, // unweighted text index
};

/** Replica of generateSlug in database/event.model.ts (pure regex chain).
 *  Drift check: diff against that function if this script's results look wrong. */
function generateSlug(title) {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

let failures = 0;
function check(ok, label, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
}

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set — run with node --env-file=.env.local');
    await mongoose.connect(uri, { bufferCommands: false, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db;
    const events = db.collection('events');

    // 1. db name
    check(db.databaseName === 'test', `connected db is 'test'`, `actual: '${db.databaseName}'`);

    // Self-check: has event.model.ts changed its index declarations since this script was written?
    try {
        const modelSrc = readFileSync(path.join(REPO_ROOT, 'database/event.model.ts'), 'utf8');
        // 7 calls as of 2026-07-20: fingerprint, {mode,date}, {city,date}, {tags,date}, {region,date}, {date,_id}, text
        const declared = (modelSrc.match(/EventSchema\.index\(/g) ?? []).length;
        if (declared !== 7) {
            console.log(`WARN  database/event.model.ts now has ${declared} EventSchema.index() calls (this script expects 7) — update EXPECTED_INDEXES above`);
        }
    } catch { console.log('WARN  could not read database/event.model.ts for the drift self-check'); }

    // 2. index inventory
    const live = await events.indexes();
    const liveByName = new Map(live.map((ix) => [ix.name, ix]));
    for (const [name, flags] of Object.entries(EXPECTED_INDEXES)) {
        const ix = liveByName.get(name);
        if (!ix) { check(false, `index ${name} exists`); continue; }
        const uniqueOk = !!ix.unique === !!flags.unique;
        const sparseOk = !!ix.sparse === !!flags.sparse;
        check(uniqueOk && sparseOk, `index ${name} flags`, `unique:${!!ix.unique} sparse:${!!ix.sparse}`);
    }
    for (const ix of live) {
        if (!(ix.name in EXPECTED_INDEXES)) check(false, `unexpected extra index ${ix.name}`, JSON.stringify(ix.key));
    }

    // 3. region INTL
    const intl = await events.countDocuments({ region: 'INTL' });
    check(intl === 0, `zero region:'INTL' docs`, `found ${intl}`);

    // 4. missing url / fingerprint
    const noUrl = await events.countDocuments({ $or: [{ url: { $exists: false } }, { url: '' }] });
    const noFp = await events.countDocuments({ fingerprint: { $exists: false } });
    check(noUrl === 0, 'zero docs missing url', `found ${noUrl}`);
    check(noFp === 0, 'zero docs missing fingerprint', `found ${noFp}`);

    // 5. slug near-misses (distinct fingerprints sharing a computed scraper slug)
    const all = await events
        .find({}, { projection: { title: 1, date: 1, city: 1, slug: 1, fingerprint: 1, _id: 0 } })
        .toArray();
    const byComputed = new Map();
    let legacySlugs = 0;
    for (const d of all) {
        const computed = generateSlug(`${d.title} ${d.date}`);
        if (d.slug !== computed) legacySlugs += 1;
        if (!byComputed.has(computed)) byComputed.set(computed, []);
        byComputed.get(computed).push(d);
    }
    const nearMisses = [...byComputed.entries()].filter(
        ([, docs]) => new Set(docs.map((d) => d.fingerprint)).size > 1,
    );
    check(nearMisses.length === 0, 'zero slug near-misses (distinct fingerprints sharing a computed slug)', `found ${nearMisses.length}`);
    for (const [slug, docs] of nearMisses) {
        console.log(`      ${slug}: ${docs.map((d) => `${d.city}/${(d.fingerprint ?? '').slice(0, 8)}`).join(' vs ')}`);
    }
    if (legacySlugs > 0) {
        console.log(`INFO  ${legacySlugs}/${all.length} docs have a stored slug != generateSlug(title+' '+date) (pre-date-era or hook-written slugs) — informational, not a failure`);
    }

    await mongoose.disconnect();
    console.log(failures === 0 ? '\nALL INVARIANTS HOLD' : `\n${failures} INVARIANT VIOLATION(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
