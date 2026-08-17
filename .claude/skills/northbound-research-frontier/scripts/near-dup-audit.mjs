/**
 * near-dup-audit.mjs — sizes the near-duplicate problem in the Northbound events DB.
 * READ-ONLY (find + in-memory similarity; zero writes). This is step (i) of
 * Front 1 (signal-to-noise) in the northbound-research-frontier skill.
 *
 * Run from the repo root:
 *   node --env-file=.env.local .claude/skills/northbound-research-frontier/scripts/near-dup-audit.mjs
 *   ... --pairs   # additionally dump ALL candidate pairs (sim >= 0.50) as TSV for hand-labeling
 *
 * What it measures — cases the exact-hash dedup can NEVER catch, because
 * buildFingerprint (database/fingerprint.ts) is sha256(lower(trim(title))|date|lower(trim(city))):
 * two docs sharing a (date, lower(city)) block therefore always differ in title
 * beyond case/whitespace, so every high-similarity pair is a genuine near-miss.
 *   1. Blocking pass: (date, lower(city)) blocks holding >1 doc; pairwise
 *      trigram-Jaccard similarity over normalized titles, bucketed >=0.90 / >=0.70 / >=0.50.
 *      Cross-source pairs are counted separately (the dedup-relevant subset).
 *   2. URL groups: the same url stored under more than one fingerprint —
 *      either a recurring series page (NOT a dupe) or title/date/city drift for
 *      one event (a dupe). The date spread per group hints which.
 *
 * Interpretation: everything printed is a CANDIDATE, not a confirmed duplicate.
 * Recurring series and multi-city editions legitimately produce near-identical
 * titles. Hand-label before drawing conclusions (Front 1, step ii).
 * Always exits 0 unless the DB is unreachable (informational instrument, not a gate).
 */
import mongoose from 'mongoose';

const PROJECTION = { fingerprint: 1, title: 1, date: 1, city: 1, source: 1, url: 1, organizer: 1 };
const SIM_FLOOR = 0.5;

function normTitle(title) {
    return String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function trigrams(s) {
    const t = `  ${s} `;
    const set = new Set();
    for (let i = 0; i <= t.length - 3; i++) set.add(t.slice(i, i + 3));
    return set;
}

function jaccard(a, b) {
    let inter = 0;
    for (const g of a) if (b.has(g)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

const fp8 = (d) => String(d.fingerprint ?? '').slice(0, 8);

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI missing — run with node --env-file=.env.local from the repo root');
    }
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    console.log(`connected db: ${db.databaseName} (expect 'test')`);
    const docs = await db.collection('events').find({}, { projection: PROJECTION }).toArray();
    console.log(`events scanned: ${docs.length}\n`);

    // ---- pass 1: block on (date, lower(city)), score titles pairwise ----
    const blocks = new Map();
    for (const d of docs) {
        const key = `${d.date}|${String(d.city ?? '').toLowerCase()}`;
        let arr = blocks.get(key);
        if (!arr) blocks.set(key, (arr = []));
        arr.push(d);
    }

    const pairs = [];
    let multiBlocks = 0;
    let docsInMultiBlocks = 0;
    for (const members of blocks.values()) {
        if (members.length < 2) continue;
        multiBlocks++;
        docsInMultiBlocks += members.length;
        const grams = members.map((m) => trigrams(normTitle(m.title)));
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const sim = jaccard(grams[i], grams[j]);
                if (sim >= SIM_FLOOR) pairs.push({ sim, a: members[i], b: members[j] });
            }
        }
    }
    pairs.sort((x, y) => y.sim - x.sim);

    const bucket = (lo, hi) => pairs.filter((p) => p.sim >= lo && p.sim < hi);
    const cross = (list) => list.filter((p) => p.a.source !== p.b.source).length;
    const b90 = bucket(0.9, Infinity);
    const b70 = bucket(0.7, 0.9);
    const b50 = bucket(0.5, 0.7);

    console.log('PASS 1 — same (date, lower(city)) blocks, trigram-Jaccard title similarity');
    console.log(`  blocks with >1 doc: ${multiBlocks} (covering ${docsInMultiBlocks} docs)`);
    console.log(`  candidate pairs sim >= 0.90: ${b90.length} (${cross(b90)} cross-source)`);
    console.log(`  candidate pairs 0.70-0.89:  ${b70.length} (${cross(b70)} cross-source)`);
    console.log(`  candidate pairs 0.50-0.69:  ${b50.length} (${cross(b50)} cross-source)`);

    console.log('\n  top candidates (hand-label these first):');
    for (const p of pairs.slice(0, 15)) {
        console.log(`  sim=${p.sim.toFixed(2)} [${p.a.date} | ${p.a.city}]`);
        console.log(`    ${fp8(p.a)} ${p.a.source.padEnd(10)} ${p.a.title}`);
        console.log(`    ${fp8(p.b)} ${p.b.source.padEnd(10)} ${p.b.title}`);
    }

    // ---- pass 2: same url under >1 fingerprint ----
    const byUrl = new Map();
    for (const d of docs) {
        if (!d.url) continue;
        let arr = byUrl.get(d.url);
        if (!arr) byUrl.set(d.url, (arr = []));
        arr.push(d);
    }
    const urlGroups = [...byUrl.values()].filter((g) => g.length > 1);
    const sameDateGroups = urlGroups.filter((g) => new Set(g.map((d) => d.date)).size === 1);
    console.log('\nPASS 2 — same url stored under multiple fingerprints');
    console.log(`  url groups with >1 doc: ${urlGroups.length}`);
    console.log(`  ... all on ONE date (dupe-suspect, not a series): ${sameDateGroups.length}`);
    console.log(`  ... spanning multiple dates (series-suspect):     ${urlGroups.length - sameDateGroups.length}`);
    for (const g of sameDateGroups.slice(0, 8)) {
        console.log(`  DUPE-SUSPECT ${g[0].date}: ${g.map((d) => `${fp8(d)}:${d.source}:"${d.title}" (${d.city})`).join('  vs  ')}`);
    }

    if (process.argv.includes('--pairs')) {
        console.log('\nTSV: sim\tfpA\tfpB\tsourceA\tsourceB\tdate\tcity\ttitleA\ttitleB');
        for (const p of pairs) {
            console.log([p.sim.toFixed(3), fp8(p.a), fp8(p.b), p.a.source, p.b.source, p.a.date, p.a.city, p.a.title, p.b.title].join('\t'));
        }
    }

    await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
