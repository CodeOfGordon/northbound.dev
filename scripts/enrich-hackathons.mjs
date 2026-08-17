/**
 * enrich-hackathons.mjs — per-event application-status + travel-reimbursement
 * enrichment for in-person US/CA hackathons. Runs in the GitHub Actions runner
 * (nightly, after the scrape job) writing straight to Atlas — NOT a Vercel
 * function, so slow third-party sites can't hit the Hobby function cap.
 *
 * Run from the repo root:
 *   node --env-file=.env.local scripts/enrich-hackathons.mjs [--dry-run] [--budget N] [--host example.org]
 *
 * Behavior contract (ADR-020, ADR-022):
 *   - Writes ONLY the `enrichment` subdocument on events docs (plus the
 *     open→closed courtesy $unset of notifiedOpenAt). The scrape pipeline never
 *     writes `enrichment` (excluded from CanonicalEvent), so these results
 *     survive the nightly rescrape $set.
 *   - The fetch unit is a HOST: one fetch enriches every selected doc sharing it.
 *   - Silence about travel is stored as 'unknown', never 'no'.
 *   - Curated overrides (scripts/hackathon-overrides.json, hostname-keyed) win
 *     over site heuristics and stamp source: 'curated'.
 *   - Never throws past a host; exits 1 only when Mongo is unreachable.
 */
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- CLI ------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BUDGET = (() => {
    const i = args.indexOf('--budget');
    const n = i >= 0 ? parseInt(args[i + 1], 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 25;
})();
const ONLY_HOST = (() => {
    const i = args.indexOf('--host');
    return i >= 0 ? String(args[i + 1] ?? '').toLowerCase() : null;
})();

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 10_000;
const SLEEP_BETWEEN_MS = 1_500;
const HORIZON_DAYS = 183;

/** Aggregator hosts whose application signal is API-owned (or useless to scan). */
const SKIP_HOSTS = new Set(['devpost.com', 'mlh.io', 'mlh.com', 'dorahacks.io', 'ethglobal.com', 'lu.ma']);

const OVERRIDES = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'hackathon-overrides.json'), 'utf8'));

// ---- date helpers (string dates, lexical compare — invariant I5) ----------
const pad = (n) => String(n).padStart(2, '0');
function todayToronto() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const monthNumber = (name) => MONTHS[name.trim().slice(0, 3).toLowerCase()] ?? null;

// ---- page text ------------------------------------------------------------
function pageText(html) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const metas = [...html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]*>/gi)].map((m) => m[1]);
    const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    return [title, ...metas, body].join(' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/\s+/g, ' ');
}

/** First same-host link whose href or text mentions FAQ. */
function findFaqLink(html, baseUrl) {
    for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
        const [, href, label] = m;
        if (!/faq/i.test(href) && !/faq/i.test(label)) continue;
        try {
            const url = new URL(href, baseUrl);
            if (url.hostname.replace(/^www\./, '') === new URL(baseUrl).hostname.replace(/^www\./, '')) return url.href;
        } catch { /* malformed href — keep looking */ }
    }
    return null;
}

// ---- classifiers ----------------------------------------------------------
function evidenceAround(text, index, matchLen) {
    const start = Math.max(0, index - 120);
    return text.slice(start, index + matchLen + 120).replace(/\s+/g, ' ').trim().slice(0, 280);
}

const CLOSED_RES = [
    /applications?\s+(?:are\s+|have\s+)?(?:now\s+)?closed/i,
    /registrations?\s+(?:is\s+|are\s+)?(?:now\s+)?closed/i,
    /no\s+longer\s+accepting/i,
    /waitlist\s+only/i,
];
const NOT_YET_RES = [
    /applications?\s+(?:will\s+)?open(?:s|ing)?\s+(?:later|soon|in\s|on\s|this\s|next\s)/i,
    /registrations?\s+(?:will\s+)?open(?:s|ing)?\s+(?:later|soon|in\s|on\s|this\s|next\s)/i,
    /applications?[^.]{0,40}coming\s+soon/i,
    /stay\s+tuned[^.]{0,60}(?:appl|regist)/i,
];
const OPEN_RES = [
    /applications?\s+(?:are\s+)?(?:now\s+)?open/i,
    /registrations?\s+(?:is\s+|are\s+)?(?:now\s+)?open/i,
    /apply\s+(?:now|here|today)/i,
    /register\s+now/i,
    /sign\s?-?ups?\s+(?:are\s+)?(?:now\s+)?open/i,
];

/** Deadline near apply/register wording: "apply by October 1(, 2026)". */
function extractDeadline(text, anchorDate) {
    const re = /(?:apply|applications?|register|registrations?)[^.]{0,80}?(?:by|due|deadline|closes?\s+(?:on\s+)?)[^.]{0,30}?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i;
    const m = text.match(re);
    if (!m) return undefined;
    const month = monthNumber(m[1]);
    const day = parseInt(m[2], 10);
    if (!month || day < 1 || day > 31) return undefined;
    if (m[3]) return `${m[3]}-${pad(month)}-${pad(day)}`;
    // No year: a deadline precedes the event start — pick the reading that does.
    const startYear = parseInt(anchorDate.slice(0, 4), 10);
    const candidate = `${startYear}-${pad(month)}-${pad(day)}`;
    return candidate <= anchorDate ? candidate : `${startYear - 1}-${pad(month)}-${pad(day)}`;
}

function classifyApplication(text, anchorDate) {
    // Deliberate statements beat lingering CTA buttons: closed → not_yet → open.
    for (const [status, res] of [['closed', CLOSED_RES], ['not_yet', NOT_YET_RES], ['open', OPEN_RES]]) {
        for (const re of res) {
            const m = text.match(re);
            if (m) {
                return {
                    status,
                    deadline: extractDeadline(text, anchorDate),
                    evidence: evidenceAround(text, m.index, m[0].length),
                };
            }
        }
    }
    return { status: 'unknown', deadline: extractDeadline(text, anchorDate) };
}

const TRAVEL_MENTION_RE = /travel|reimburs|stipend|bus(?:es|sing)?\s+(?:from|to|provided)|flight\s+(?:credit|reimburs)/i;
const TRAVEL_NO_RES = [
    // Stemmed verbs ("providing"/"provide"/"provided") — a literal 'provide' missed
    // "we will not be providing any travel reimbursements" (seen live, uofthacks.com).
    /(?:no|not|unable\s+to|cannot|can'?t|won'?t|do(?:es)?\s+not)\s+(?:be\s+)?[^.]{0,40}?(?:reimburs|cover|provid|offer)\w*[^.]{0,40}?travel/i,
    /travel[^.]{0,60}?(?:is|are|will\s+be)\s+not\s+(?:covered|reimbursed|provided|offered)/i,
    /travel[^.]{0,60}?(?:is|are)\s+the\s+responsibility/i,
    /no\s+travel\s+(?:reimbursements?|stipends?|grants?|funding|assistance)/i,
];
const TRAVEL_YES_RES = [
    /travel\s+(?:reimbursements?|grants?|stipends?|scholarships?|assistance|funding)[^.]{0,60}?(?:is|are|will\s+be)?\s*(?:available|offered|provided)/i,
    /(?:we\s+(?:will\s+)?(?:offer|provide|cover)|will\s+(?:be\s+)?(?:provid|offer|cover))[^.]{0,40}?travel/i,
    /reimburse[^.]{0,50}?travel/i,
    /travel\s+(?:will\s+be\s+)?reimbursed/i,
    /apply\s+for\s+travel\s+(?:reimbursements?|stipends?|grants?|funding)/i,
];

function classifyTravel(text) {
    const gate = text.match(TRAVEL_MENTION_RE);
    if (!gate) return { status: 'unknown' }; // silence is never a 'no'
    for (const [status, res] of [['no', TRAVEL_NO_RES], ['yes', TRAVEL_YES_RES]]) {
        for (const re of res) {
            const m = text.match(re);
            if (m) {
                const evidence = evidenceAround(text, m.index, m[0].length);
                const amountM = evidence.match(/(?:up\s+to\s+|maximum\s+of\s+)?\$\s?\d{2,4}/i);
                return { status, amount: amountM ? amountM[0].replace(/\s+/g, ' ') : undefined, evidence };
            }
        }
    }
    return { status: 'unknown', evidence: evidenceAround(text, gate.index, gate[0].length) };
}

// ---- staleness ------------------------------------------------------------
function isStale(doc, today) {
    const e = doc.enrichment;
    if (!e?.checkedAt) return true;
    const ageDays = (Date.now() - Date.parse(e.checkedAt)) / 86_400_000;
    if (Number.isNaN(ageDays)) return true;
    if (e.fetchStatus !== 'ok') return ageDays >= 7; // backoff — don't hammer failing hosts
    const soon = doc.date <= addDays(today, 60);
    return ageDays >= (soon ? 3 : 7);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
    const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
    });
    if (!res.ok) { const err = new Error(`${url} → ${res.status}`); err.status = res.status; throw err; }
    return res.text();
}

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    } catch (e) {
        console.error(`Mongo connection failed: ${e.message}`);
        process.exit(1);
    }
    const events = mongoose.connection.db.collection('events');
    const today = todayToronto();

    const selected = await events
        .find({
            category: 'hackathon',
            mode: { $ne: 'online' },
            region: { $in: ['US', 'CA'] },
            date: { $gte: today, $lte: addDays(today, HORIZON_DAYS) },
        })
        .project({ _id: 1, title: 1, url: 1, date: 1, enrichment: 1, notifiedOpenAt: 1 })
        .toArray();

    // Group stale docs by host (the fetch unit).
    const byHost = new Map();
    for (const doc of selected) {
        let host;
        try { host = new URL(doc.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { continue; }
        if ([...SKIP_HOSTS].some((s) => host === s || host.endsWith(`.${s}`))) continue;
        if (ONLY_HOST && host !== ONLY_HOST) continue;
        if (!isStale(doc, today) && !ONLY_HOST) continue;
        if (!byHost.has(host)) byHost.set(host, []);
        byHost.get(host).push(doc);
    }

    const hosts = [...byHost.keys()].slice(0, BUDGET);
    const skippedForBudget = byHost.size - hosts.length;
    console.log(`${selected.length} in-person US/CA hackathons in the next ${HORIZON_DAYS}d; ` +
        `${byHost.size} stale hosts, enriching ${hosts.length} (budget ${BUDGET}${DRY_RUN ? ', dry-run' : ''})`);

    const summary = [];
    for (const host of hosts) {
        const docs = byHost.get(host);
        const anchorDate = docs.map((d) => d.date).sort()[0];
        let fetchStatus = 'ok';
        let application = { status: 'unknown' };
        let travel = { status: 'unknown' };

        try {
            const landingUrl = docs[0].url;
            const landingHtml = await fetchText(landingUrl);
            let text = pageText(landingHtml);
            const faqUrl = findFaqLink(landingHtml, landingUrl);
            if (faqUrl && faqUrl.replace(/\/$/, '') !== landingUrl.replace(/\/$/, '')) {
                await sleep(SLEEP_BETWEEN_MS);
                try {
                    text += ' ' + pageText(await fetchText(faqUrl));
                } catch (e) {
                    console.warn(`  ${host}: FAQ page failed (${e.message}) — using landing page only`);
                }
            }
            application = classifyApplication(text, anchorDate);
            travel = classifyTravel(text);
        } catch (e) {
            fetchStatus = e.status === 403 ? 'blocked' : 'fetch_failed';
        }

        // Curated override wins for travel (org-level policy, stable across editions).
        const override = OVERRIDES[host];
        let source = 'site';
        if (override?.travel) {
            travel = { ...override.travel };
            source = 'curated';
        }

        const enrichment = {
            host,
            checkedAt: new Date().toISOString(),
            source,
            fetchStatus,
            application: { status: application.status, ...(application.deadline ? { deadline: application.deadline } : {}), ...(application.evidence ? { evidence: application.evidence } : {}) },
            travel: { status: travel.status, ...(travel.amount ? { amount: travel.amount } : {}), ...(travel.evidence ? { evidence: travel.evidence } : {}) },
        };

        if (!DRY_RUN) {
            for (const doc of docs) {
                const update = { $set: { enrichment } };
                // Courtesy for the digest (ADR-022): a real open→closed transition
                // clears the notified marker so a later re-open re-notifies.
                const wasOpen = doc.enrichment?.application?.status === 'open';
                if (wasOpen && application.status === 'closed' && doc.notifiedOpenAt) {
                    update.$unset = { notifiedOpenAt: '' };
                }
                await events.updateOne({ _id: doc._id }, update);
            }
        }
        summary.push({ host, docs: docs.length, fetch: fetchStatus, apps: application.status, deadline: application.deadline ?? '', travel: travel.status, src: source });
        await sleep(SLEEP_BETWEEN_MS);
    }

    console.table(summary);
    if (skippedForBudget > 0) console.log(`NOTE: ${skippedForBudget} stale host(s) skipped for budget — they'll be picked up on later runs.`);
    if (DRY_RUN) console.log('Dry run: no writes performed.');
    await mongoose.disconnect();
}

main();
