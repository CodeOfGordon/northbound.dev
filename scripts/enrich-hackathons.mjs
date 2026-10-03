/**
 * enrich-hackathons.mjs — per-event application-status + travel-reimbursement
 * enrichment for in-person US/CA hackathons. Runs in the GitHub Actions runner
 * (nightly, after the scrape job; and every 6 h in --apps-only mode) writing
 * straight to Atlas — NOT a Vercel function, so slow third-party sites can't
 * hit the Hobby function cap.
 *
 * Run from the repo root:
 *   node --env-file=.env.local scripts/enrich-hackathons.mjs [--dry-run] [--budget N] [--host example.org]
 *   node --env-file=.env.local scripts/enrich-hackathons.mjs --apps-only   # light application-state pass
 *
 * Behavior contract (ADR-020, ADR-022, ADR-029):
 *   - Writes ONLY the `enrichment` subdocument on events docs (plus the
 *     open→closed courtesy $unset of notifiedOpenAt). The scrape pipeline never
 *     writes `enrichment` (excluded from CanonicalEvent), so these results
 *     survive the nightly rescrape $set. --apps-only writes only
 *     `enrichment.application`.
 *   - The fetch unit is a HOST: one fetch enriches every selected doc sharing it.
 *   - Silence about travel is stored as 'unknown', never 'no'.
 *   - Only HACKER applications count; bare "Apply now" CTAs are not evidence of
 *     open. The apply portal linked from the page is followed (cross-host) and
 *     its closed state outranks the landing page.
 *   - Every deadline tier is stored (enrichment.application.deadlines);
 *     observation timestamps (openSeenAt / closedSeenAt) carry across runs.
 *   - Curated overrides (scripts/hackathon-overrides.json): travel policy per
 *     host, plus edition-pinned deadlines that apply only to the doc whose
 *     start matches the edition (± 3 days), so they can't rot.
 *   - Recheck cadence follows application state, and stale hosts are processed
 *     nearest-deadline first so the budget never starves the urgent ones.
 *   - Never throws past a host; exits 1 only when Mongo is unreachable.
 */
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    classifyApplication,
    classifyPortal,
    classifyTravel,
    curatedDeadlines,
    findApplyLinks,
    findFaqLink,
    mergeApplication,
    nextDeadline,
    overrideFor,
    pageText,
    recheckHours,
    urgencyKey,
} from './lib/classify-application.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- CLI ------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
/**
 * Light pass (every 6 h): application state only — landing page + apply
 * portal, static fetch, no travel probes / archives / rendering — for hosts
 * whose applications are open or about to open, or whose deadline is within
 * 14 days. Catches a closure within hours instead of days. (ADR-029)
 */
const APPS_ONLY = args.includes('--apps-only');
const BUDGET = (() => {
    const i = args.indexOf('--budget');
    const n = i >= 0 ? parseInt(args[i + 1], 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : APPS_ONLY ? 40 : 25;
})();
const ONLY_HOST = (() => {
    const i = args.indexOf('--host');
    return i >= 0 ? String(args[i + 1] ?? '').toLowerCase() : null;
})();
const REFRESH_UNKNOWN = args.includes('--refresh-unknown');
/** Re-check every host regardless of cadence — for after a classifier fix. */
const REFRESH_ALL = args.includes('--refresh-all');
/**
 * Hard wall-clock budget. Rendering + archive lookups make per-host cost highly
 * variable (a slow site can burn a minute on its own), and an unbounded nightly
 * job is an operational hazard — one CI run sat at 60+ minutes before this
 * existed. Whatever doesn't fit is simply picked up by the next run, since the
 * staleness cadence already makes progress resumable.
 */
const MAX_RUNTIME_MS = (() => {
    const i = args.indexOf('--max-minutes');
    const n = i >= 0 ? parseFloat(args[i + 1]) : NaN;
    return (Number.isFinite(n) && n > 0 ? n : APPS_ONLY ? 5 : 12) * 60_000;
})();
const startedAt = Date.now();
const NO_RENDER = args.includes('--no-render') || APPS_ONLY;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 10_000;
const RENDER_TIMEOUT_MS = 20_000;
const SLEEP_BETWEEN_MS = 1_500;
/**
 * Selection horizon. Applications for the majors open months ahead (TreeHacks
 * in October for February), so this is a year, not the old 6 months; the
 * urgency ordering below keeps the budget on what closes soonest.
 */
const HORIZON_DAYS = 365;
/** --apps-only re-checks a live host once this many hours have passed. */
const APPS_ONLY_RECHECK_HOURS = 5;

/** Conventional FAQ/travel paths probed when the linked pages say nothing about travel. */
const TRAVEL_PROBE_PATHS = ['/faq', '/faqs', '/travel', '/about'];

/** Aggregator hosts whose application signal is API-owned (or useless to scan). */
const SKIP_HOSTS = new Set(['devpost.com', 'mlh.io', 'mlh.com', 'dorahacks.io', 'ethglobal.com', 'lu.ma']);

const OVERRIDES = JSON.parse(readFileSync(path.join(SCRIPT_DIR, 'hackathon-overrides.json'), 'utf8'));

// ---- date helpers (string dates, lexical compare — invariant I5) ----------
function todayToronto() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ---- staleness --------------------------------------------------------------
/** Newest check of any kind (full pass or the application-only pass). */
function lastCheckMs(e) {
    const t = [e?.checkedAt, e?.application?.checkedAt].map((x) => Date.parse(x ?? '')).filter((x) => !Number.isNaN(x));
    return t.length ? Math.max(...t) : NaN;
}

/** Application state worth a light re-check: live, or a deadline within two weeks. */
function isLiveForAppsPass(doc, today) {
    const app = doc.enrichment?.application;
    if (!app) return false;
    if (app.status === 'open' || app.status === 'not_yet') return true;
    const next = nextDeadline(app, today);
    return !!next && daysBetween(today, next) <= 14;
}

function isStale(doc, today) {
    if (REFRESH_ALL) return true;
    const e = doc.enrichment;
    if (APPS_ONLY) {
        if (!isLiveForAppsPass(doc, today)) return false;
        const age = (Date.now() - lastCheckMs(e)) / 3_600_000;
        return Number.isNaN(age) || age >= APPS_ONLY_RECHECK_HOURS;
    }
    if (!e?.checkedAt) return true;
    // Backfill lever: re-check hosts whose travel policy we never resolved,
    // ignoring the cadence (used after improving the classifiers/probes).
    if (REFRESH_UNKNOWN && e.travel?.status === 'unknown') return true;
    // Cadence is driven by APPLICATION state (ADR-029) — an open application
    // with a deadline this week is checked daily, a closed one weekly.
    const ageHours = (Date.now() - Date.parse(e.checkedAt)) / 3_600_000;
    if (Number.isNaN(ageHours)) return true;
    return ageHours >= recheckHours(e, today);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- JS rendering fallback ------------------------------------------------
 * Most university hackathon sites are client-rendered SPAs: their FAQ (where
 * the travel policy lives) is absent from the raw HTML entirely, so the static
 * pass above can only ever return 'unknown' for them. Playwright is already a
 * devDependency (it backs the screenshot tooling), and it is what Crawlee /
 * Firecrawl / crawl4ai use underneath — so we drive it directly rather than
 * adding a crawl framework we'd use 5% of. Rendering is the EXPENSIVE path, so
 * it only runs for hosts the cheap path left unresolved. (ADR-027)
 */
let browserPromise = null;
let renderOff = NO_RENDER;

async function getBrowser() {
    if (renderOff) return null;
    if (!browserPromise) {
        browserPromise = (async () => {
            try {
                const { chromium } = await import('playwright');
                return await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
            } catch (e) {
                console.warn(`::warning::JS rendering unavailable (${e.message}) — static HTML only.`);
                renderOff = true;
                return null;
            }
        })();
    }
    return browserPromise;
}

/**
 * Full post-JavaScript text of a page. Uses textContent, not innerText: FAQ
 * answers are usually in the DOM but collapsed, and innerText would drop
 * exactly the hidden accordion text we're after.
 */
async function renderText(url, isEnough = () => false) {
    const browser = await getBrowser();
    if (!browser) return '';
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
    try {
        const page = await context.newPage();
        // Skip images/media/fonts — we only ever read text.
        await page.route('**/*', (route) =>
            ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue(),
        );
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });

        // Hydration is uneven across these sites (one returned a single
        // character on first paint) — poll for real content instead of a fixed
        // sleep, then give late-loading sections a short grace period.
        await page
            .waitForFunction(() => (document.body?.textContent ?? '').trim().length > 300, null, { timeout: 8_000 })
            .catch(() => {});
        await page.waitForTimeout(1_000);

        // FAQ answers — where travel policy lives — are usually collapsed, and
        // collapsed text is absent from textContent. Open <details> and click
        // the toggles that look like FAQ questions before reading.
        await page.evaluate(() => {
            document.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
        });
        const toggles = await page.$$(
            'summary, button, [role="button"], [class*="accordion" i], [class*="faq" i], [class*="question" i]',
        );
        const candidates = [];
        for (const el of toggles) {
            const label = ((await el.textContent()) ?? '').trim();
            // Questions end in '?'; also chase anything naming the policy directly.
            if (label.length > 140 || !(label.endsWith('?') || /travel|reimburs|stipend/i.test(label))) continue;
            candidates.push({ el, priority: /travel|reimburs|stipend/i.test(label) ? 0 : 1 });
        }
        // Travel questions first: long FAQ grids bury them (HackRice's is #36),
        // and a plain DOM-order pass would exhaust the click budget before it.
        candidates.sort((a, b) => a.priority - b.priority);

        // textContent includes <style>/<script> bodies — strip them on a clone so
        // evidence snippets are readable prose, not CSS keyframes.
        const snapshot = async () =>
            (
                await page.evaluate(() => {
                    const clone = document.body?.cloneNode(true);
                    if (!clone) return '';
                    clone.querySelectorAll('script, style, noscript, svg').forEach((n) => n.remove());
                    return clone.textContent ?? '';
                })
            )
                .replace(/\s+/g, ' ')
                .trim();

        let best = await snapshot();
        if (isEnough(best)) return best;

        for (const { el } of candidates.slice(0, 25)) {
            // These accordions are single-open: each click collapses the last
            // one, so read after EVERY click and stop as soon as the answer we
            // came for is on screen — batching clicks then reading loses it.
            await el.click({ timeout: 1_200, noWaitAfter: true }).catch(() => {});
            await page.waitForTimeout(250);
            const snap = await snapshot();
            if (isEnough(snap)) return snap;
            if (snap.length > best.length) best = snap;
        }
        return best;
    } catch (e) {
        console.warn(`  render failed ${url} — ${e.message}`);
        return '';
    } finally {
        await context.close().catch(() => {});
    }
}

/**
 * Prior-edition lookup: when the current site says nothing about travel, check
 * the previous editions — most of these hackathons archive them on year
 * subdomains (2025.example.org). A past policy predicts the next one well
 * enough to be worth surfacing, but it is NOT a promise, so findings are
 * stamped basis:'prior-edition' + the year and worded differently everywhere
 * they appear. Bounded to the last 3 editions: a hackathon that reimbursed
 * once a decade ago tells us nothing. (ADR-028)
 */
const ARCHIVE_LOOKBACK_YEARS = 3;
const ARCHIVE_TIMEOUT_MS = 8_000;

async function fetchArchiveText(url) {
    const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
        redirect: 'follow',
    });
    if (!res.ok) throw new Error(String(res.status));
    return pageText(await res.text());
}

/** First recent edition whose site states a travel policy, or null. */
async function priorEditionTravel(host, thisYear, delayMs) {
    const root = host.split('.').slice(-2).join('.');
    for (let i = 1; i <= ARCHIVE_LOOKBACK_YEARS; i++) {
        const year = thisYear - i;
        const url = `https://${year}.${root}/`;
        await sleep(delayMs);
        let text = '';
        try {
            text = await fetchArchiveText(url);
        } catch {
            continue; // no archive for that year — very common
        }
        // Archived SPAs need the browser too, but only bother if the static
        // pass looks empty AND mentions nothing useful.
        if (text.length < 800 && !renderOff) {
            const rendered = await renderText(url, (t) => classifyTravel(t).status !== 'unknown');
            if (rendered) text = rendered;
        }
        const t = classifyTravel(text);
        if (t.status !== 'unknown') {
            return { ...t, basis: 'prior-edition', year, evidence: `${year} edition: ${t.evidence ?? ''}`.trim().slice(0, 280) };
        }
    }
    return null;
}

/* ---- robots.txt ------------------------------------------------------------
 * These are small volunteer-run student sites, so we behave like a courteous
 * crawler: one robots.txt per host per run, cached, and we honor Disallow for
 * `*` plus any Crawl-delay longer than our own pacing. Failing open on a
 * missing/unreachable robots.txt is the standard reading of the spec.
 */
const robotsCache = new Map();

async function getRobots(origin) {
    if (robotsCache.has(origin)) return robotsCache.get(origin);
    const rules = { disallow: [], allow: [], crawlDelayMs: 0 };
    try {
        const res = await fetch(`${origin}/robots.txt`, {
            headers: { 'user-agent': UA },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (res.ok && (res.headers.get('content-type') ?? '').includes('text')) {
            let applies = false;
            for (const raw of (await res.text()).split('\n')) {
                const line = raw.split('#')[0].trim();
                const [field, ...rest] = line.split(':');
                const value = rest.join(':').trim();
                if (!field || !value) continue;
                const key = field.trim().toLowerCase();
                if (key === 'user-agent') applies = value === '*';
                else if (!applies) continue;
                else if (key === 'disallow') rules.disallow.push(value);
                else if (key === 'allow') rules.allow.push(value);
                else if (key === 'crawl-delay') rules.crawlDelayMs = (parseFloat(value) || 0) * 1000;
            }
        }
    } catch {
        // no robots.txt / unreachable → fail open
    }
    robotsCache.set(origin, rules);
    return rules;
}

/** Longest-match wins, Allow beating Disallow at equal length (standard behavior). */
function robotsAllows(rules, pathname) {
    const longest = (list) =>
        list.filter((p) => p && pathname.startsWith(p)).reduce((max, p) => Math.max(max, p.length), -1);
    const blocked = longest(rules.disallow);
    if (blocked < 0) return true;
    return longest(rules.allow) >= blocked;
}

async function fetchText(url) {
    const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
    });
    if (!res.ok) { const err = new Error(`${url} → ${res.status}`); err.status = res.status; throw err; }
    return res.text();
}

/** Hosts the curated watchlist expects to see (lib/data/watchlist.ts is TS; read its hosts as text). */
function watchlistHosts() {
    try {
        const src = readFileSync(path.join(SCRIPT_DIR, '..', 'lib', 'data', 'watchlist.ts'), 'utf8');
        return [...src.matchAll(/host:\s*'([^']+)'/g)].map((m) => m[1].toLowerCase());
    } catch {
        return [];
    }
}

/**
 * Hacker-application state for one host: the landing page (+ FAQ), then the
 * apply portal it links to. Returns the classifier read plus what it saw.
 */
async function readApplications(landingUrl, landingHtml, robots, hostDelayMs, anchorDate) {
    let text = pageText(landingHtml);
    const faqUrl = !APPS_ONLY ? findFaqLink(landingHtml, landingUrl) : null;
    if (faqUrl && faqUrl.replace(/\/$/, '') !== landingUrl.replace(/\/$/, '') && robotsAllows(robots, new URL(faqUrl).pathname)) {
        await sleep(hostDelayMs);
        try {
            text += ' . ' + pageText(await fetchText(faqUrl));
        } catch (e) {
            console.warn(`  ${new URL(landingUrl).hostname}: FAQ page failed (${e.message}) — using landing page only`);
        }
    }
    let read = classifyApplication(text, anchorDate);

    // The portal is where "closed" actually shows (a hero "Apply" button
    // outlives the application on most sites). Follow the page's own link —
    // never a guessed apply.<site>, which can be last year's form.
    let portal = null;
    for (const href of findApplyLinks(landingHtml, landingUrl)) {
        let portalUrl;
        try {
            portalUrl = new URL(href);
        } catch {
            continue;
        }
        const portalRobots = portalUrl.origin === new URL(landingUrl).origin ? robots : await getRobots(portalUrl.origin);
        if (!robotsAllows(portalRobots, portalUrl.pathname)) continue;
        await sleep(Math.max(hostDelayMs, portalRobots.crawlDelayMs));
        let portalText;
        try {
            portalText = pageText(await fetchText(portalUrl.href));
        } catch {
            continue; // dead or blocked link — try the next candidate
        }
        const p = classifyPortal(portalText, anchorDate);
        portal = { url: portalUrl.href, ...p };
        if (p.status !== 'unknown') break;
    }

    if (portal) {
        const deadlines = mergeTiers(read.deadlines, portal.deadlines ?? []);
        if (portal.status === 'closed') {
            read = { ...read, status: 'closed', waitlist: portal.waitlist, evidence: `Portal: ${portal.evidence ?? ''}`.slice(0, 280), deadlines };
        } else if (portal.status === 'open' || (portal.status === 'not_yet' && read.status !== 'closed')) {
            read = { ...read, status: portal.status, evidence: `Portal: ${portal.evidence ?? ''}`.slice(0, 280), deadlines };
        } else {
            read = { ...read, deadlines };
        }
        read.portal = portal.url;
    }
    return { read, text };
}

/** Union of two deadline lists, first list winning per tier. */
function mergeTiers(a, b) {
    const keys = new Set(a.map((d) => `${d.kind}|${d.audience}`));
    return [...a, ...b.filter((d) => !keys.has(`${d.kind}|${d.audience}`))];
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
        .project({ _id: 1, title: 1, url: 1, date: 1, source: 1, enrichment: 1, notifiedOpenAt: 1 })
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

    // Nearest deadline first, then live states, then soonest event — the
    // budget must never defer the host that closes tomorrow.
    const ordered = [...byHost.keys()].sort((a, b) => urgencyKey(byHost.get(a), today).localeCompare(urgencyKey(byHost.get(b), today)));
    const hosts = ordered.slice(0, BUDGET);
    const skippedForBudget = byHost.size - hosts.length;
    console.log(`${APPS_ONLY ? '[apps-only] ' : ''}${selected.length} in-person US/CA hackathons in the next ${HORIZON_DAYS}d; ` +
        `${byHost.size} stale hosts, enriching ${hosts.length} (budget ${BUDGET}${DRY_RUN ? ', dry-run' : ''})`);

    const summary = [];
    let deferred = 0;
    /** Application records written this run — the coverage warnings below judge the NEW state. */
    const written = new Map();
    const nowIso = () => new Date().toISOString();
    for (const host of hosts) {
        if (Date.now() - startedAt > MAX_RUNTIME_MS) {
            deferred = hosts.length - summary.length;
            console.log(`Time budget (${Math.round(MAX_RUNTIME_MS / 60_000)}m) reached — ${deferred} host(s) deferred to the next run.`);
            break;
        }
        const docs = byHost.get(host);
        const anchorDate = docs.map((d) => d.date).sort()[0];
        let fetchStatus = 'ok';
        let read = { status: 'unknown', deadlines: [] };
        let travel = { status: 'unknown' };
        let usedRender = false;
        let hostDelayMs = SLEEP_BETWEEN_MS; // raised if robots.txt asks for more

        try {
            const landingUrl = docs[0].url;

            // Ask permission before touching the site at all.
            const origin = new URL(landingUrl).origin;
            const robots = await getRobots(origin);
            hostDelayMs = Math.max(SLEEP_BETWEEN_MS, robots.crawlDelayMs);
            if (!robotsAllows(robots, new URL(landingUrl).pathname)) {
                console.warn(`  ${host}: robots.txt disallows — skipping`);
                summary.push({ host, docs: docs.length, fetch: 'blocked', apps: 'unknown', deadlines: '', portal: '', travel: 'unknown', src: 'site', js: '' });
                await sleep(hostDelayMs);
                continue;
            }

            const landingHtml = await fetchText(landingUrl);
            const apps = await readApplications(landingUrl, landingHtml, robots, hostDelayMs, anchorDate);
            read = apps.read;

            if (!APPS_ONLY) {
                travel = classifyTravel(apps.text);

                // Many hackathon sites are SPA routers: the FAQ exists at a
                // conventional path but is never a plain <a> in the raw HTML, so the
                // link scan above misses it. When travel is still unknown (the
                // expensive-to-miss signal), probe a couple of conventional paths.
                if (travel.status === 'unknown') {
                    const tried = new Set([landingUrl.replace(/\/$/, '')]);
                    for (const probePath of TRAVEL_PROBE_PATHS) {
                        const probe = new URL(probePath, landingUrl).href;
                        if (!robotsAllows(robots, probePath)) continue;
                        if (tried.has(probe.replace(/\/$/, ''))) continue;
                        tried.add(probe.replace(/\/$/, ''));
                        await sleep(hostDelayMs);
                        let probeText;
                        try {
                            probeText = pageText(await fetchText(probe));
                        } catch {
                            continue; // 404s are the common case — keep probing
                        }
                        const probeTravel = classifyTravel(probeText);
                        if (probeTravel.status !== 'unknown') {
                            travel = probeTravel;
                            if (read.status === 'unknown') {
                                const a = classifyApplication(probeText, anchorDate);
                                read = { ...a, deadlines: mergeTiers(read.deadlines, a.deadlines), portal: read.portal };
                            }
                            break;
                        }
                    }
                }

                // Static HTML said nothing about travel (or applications) — the
                // site is very likely a client-rendered SPA. Fall back to a real
                // browser (landing page, then its /faq route) and re-classify.
                if (travel.status === 'unknown' || (read.status === 'unknown' && !read.deadlines.length)) {
                    const resolvesTravel = (t) => classifyTravel(t).status !== 'unknown';
                    for (const url of [landingUrl, new URL('/faq', landingUrl).href]) {
                        if (!robotsAllows(robots, new URL(url).pathname)) continue;
                        await sleep(hostDelayMs); // pace the rendered pages too
                        const rendered = await renderText(url, resolvesTravel);
                        if (!rendered) continue;
                        usedRender = true;
                        if (read.status === 'unknown' || !read.deadlines.length) {
                            const a = classifyApplication(rendered, anchorDate);
                            read = {
                                ...read,
                                ...(read.status === 'unknown' && a.status !== 'unknown' ? { status: a.status, evidence: a.evidence, waitlist: a.waitlist } : {}),
                                deadlines: mergeTiers(read.deadlines, a.deadlines),
                                rolling: read.rolling || a.rolling,
                            };
                        }
                        const t = classifyTravel(rendered);
                        if (travel.status === 'unknown' && t.status !== 'unknown') {
                            travel = t;
                            break;
                        }
                    }
                }
                // Nothing about travel on the current site — ask the recent editions.
                if (travel.status === 'unknown') {
                    const prior = await priorEditionTravel(host, parseInt(anchorDate.slice(0, 4), 10), hostDelayMs);
                    if (prior) travel = prior;
                } else if (!travel.basis) {
                    travel.basis = 'current';
                }
            }
        } catch (e) {
            fetchStatus = e.status === 403 ? 'blocked' : 'fetch_failed';
        }

        // Curated travel override wins (org-level policy, stable across editions).
        const override = overrideFor(OVERRIDES, host);
        let source = 'site';
        if (override?.travel) {
            travel = { basis: 'current', ...override.travel };
            source = 'curated';
        }

        let deadlineCount = 0;
        if (!DRY_RUN) {
            for (const doc of docs) {
                const curated = curatedDeadlines(override, doc.date);
                // A failed fetch keeps what we already knew rather than erasing it.
                const docRead = fetchStatus === 'ok'
                    ? read
                    : {
                          status: doc.enrichment?.application?.status ?? 'unknown',
                          deadlines: (doc.enrichment?.application?.deadlines ?? []).filter((d) => d.source !== 'curated'),
                          evidence: doc.enrichment?.application?.evidence,
                          portal: doc.enrichment?.application?.portal,
                      };
                const application = mergeApplication(doc.enrichment, docRead, curated, nowIso());
                deadlineCount = Math.max(deadlineCount, application.deadlines?.length ?? 0);
                written.set(String(doc._id), application);

                let update;
                if (APPS_ONLY) {
                    update = { $set: { 'enrichment.application': { ...application, checkedAt: nowIso() } } };
                } else {
                    const keptTravel = fetchStatus !== 'ok' && !override?.travel && doc.enrichment?.travel ? doc.enrichment.travel : travel;
                    update = {
                        $set: {
                            enrichment: {
                                host,
                                checkedAt: nowIso(),
                                // Travel provenance; each deadline carries its own source.
                                source,
                                fetchStatus,
                                application,
                                travel: {
                                    status: keptTravel.status,
                                    ...(keptTravel.amount ? { amount: keptTravel.amount } : {}),
                                    ...(keptTravel.evidence ? { evidence: keptTravel.evidence } : {}),
                                    ...(keptTravel.basis ? { basis: keptTravel.basis } : {}),
                                    ...(keptTravel.year ? { year: keptTravel.year } : {}),
                                },
                            },
                        },
                    };
                }
                // Courtesy for the digest (ADR-022): a real open→closed transition
                // clears the notified marker so a later re-open re-notifies.
                const wasOpen = doc.enrichment?.application?.status === 'open';
                if (wasOpen && application.status === 'closed' && doc.notifiedOpenAt) {
                    update.$unset = { notifiedOpenAt: '' };
                }
                await events.updateOne({ _id: doc._id }, update);
            }
        } else {
            deadlineCount = read.deadlines?.length ?? 0;
        }
        summary.push({
            host,
            docs: docs.length,
            fetch: fetchStatus,
            apps: read.status,
            deadlines: (read.deadlines ?? []).map((d) => `${d.kind[0]}:${d.date}`).join(' ') || (deadlineCount ? `${deadlineCount} curated` : ''),
            portal: read.portal ? new URL(read.portal).hostname : '',
            travel: APPS_ONLY ? '-' : travel.status + (travel.basis === 'prior-edition' ? ` (${travel.year})` : ''),
            src: source,
            js: usedRender ? 'yes' : '',
        });
        await sleep(hostDelayMs);
    }

    console.table(summary);
    if (skippedForBudget + deferred > 0) {
        console.log(`NOTE: ${skippedForBudget + deferred} stale host(s) not processed this run — they'll be picked up on later runs.`);
    }

    // Coverage warnings (F6): gaps surface in the run log, not on Instagram.
    if (!APPS_ONLY) {
        const seenHosts = new Set(selected.map((d) => { try { return new URL(d.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }));
        for (const h of watchlistHosts()) {
            if (!seenHosts.has(h)) console.log(`::notice::watchlist host ${h} has no upcoming event doc (dormant — next edition not announced or not detected).`);
        }
        for (const doc of selected) {
            const e = doc.enrichment;
            const app = written.get(String(doc._id)) ?? e?.application;
            const major = doc.source === 'watchlist' || e?.source === 'curated' || e?.travel?.status === 'yes';
            const hasDeadline = (app?.deadlines ?? []).length > 0 || !!app?.deadline;
            if (major && !hasDeadline && daysBetween(today, doc.date) <= 84 && app?.status !== 'closed') {
                console.log(`::warning::${doc.title} (${doc.date}) has no published application deadline we can read — curate one in hackathon-overrides.json if it's announced elsewhere.`);
            }
        }
        for (const [key, ov] of Object.entries(OVERRIDES)) {
            for (const ed of ov?.editions ?? []) {
                if (!ed?.eventStart || ed.eventStart < today) continue;
                const matched = selected.some((d) => {
                    try {
                        const h = new URL(d.url).hostname.replace(/^www\./, '').toLowerCase();
                        return overrideFor({ [key]: ov }, h) && Math.abs(daysBetween(ed.eventStart, d.date)) <= 3;
                    } catch {
                        return false;
                    }
                });
                if (!matched) console.log(`::warning::curated deadlines for ${key} (edition starting ${ed.eventStart}) match no event doc.`);
            }
        }
    }

    console.log(`Ran ${Math.round((Date.now() - startedAt) / 1000)}s.`);
    if (DRY_RUN) console.log('Dry run: no writes performed.');
    if (browserPromise) await (await browserPromise)?.close().catch(() => {});
    await mongoose.disconnect();
}

main();
