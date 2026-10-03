/**
 * Pure page-text classifiers for the hackathon enrichment pass
 * (scripts/enrich-hackathons.mjs) — no I/O, so tests/classify-application.test.mjs
 * pins them against real-world phrasings without touching the network.
 *
 * ADR-029 changes from the original in-script classifiers:
 *   - Only HACKER applications count. Mentor / volunteer / judge / sponsor
 *     statements are vetoed, and bare "Apply now" CTAs are no longer evidence of
 *     open (they outlive the application on most sites) — they only flag that a
 *     portal is worth checking.
 *   - Every deadline tier is extracted (priority / regular / international /
 *     travel), from month-name AND numeric dates ("by 9/13 (priority) / 9/20
 *     (regular)" — Cal Hacks 13.0, missed entirely by the old month-name regex),
 *     with times, zone abbreviations and "extended until …".
 *   - Application portals (Google Forms, Typeform, Tally, Luma, custom
 *     `apply.`/`my.`/`hive.` hosts) are classified for closed state; a sign-in
 *     wall is 'unknown', never 'open'.
 */

/* ---- page text ------------------------------------------------------------ */

export function pageText(html) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const metas = [...html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]*>/gi)].map((m) => m[1]);
    const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        // Block-level boundaries become sentence breaks so a heading or button
        // label never fuses with the next sentence (clause scoping relies on it).
        .replace(/<\/?(?:p|div|li|h[1-6]|section|article|header|footer|tr|td|br|button|summary|details|dt|dd)\b[^>]*>/gi, ' . ')
        .replace(/<[^>]+>/g, ' ');
    return [title, ...metas, body]
        .join(' . ')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;|&#39;|&apos;|&rsquo;|&#8217;/g, "'")
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&ndash;|&#8211;/g, '–')
        .replace(/\s+/g, ' ')
        .replace(/(?:\s*\.\s*){2,}/g, ' . ');
}

/** First same-host link whose href or text mentions FAQ. */
export function findFaqLink(html, baseUrl) {
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

/* ---- clause helpers -------------------------------------------------------- */

/**
 * True when the match sits inside an interrogative sentence. FAQ pages list
 * their questions in the DOM even when the answers are collapsed, so
 * "Is reimbursement offered for travel expenses?" would otherwise read as a
 * policy statement — it says nothing about the answer. (ADR-028)
 */
export function isQuestionContext(text, index, matchLen) {
    const rest = text.slice(index + matchLen);
    const end = rest.search(/[.?!]/);
    return end !== -1 && rest[end] === '?';
}

/** First match of `re` that is an actual statement, not a FAQ question. */
export function firstStatementMatch(text, re, accept = () => true) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(global)) {
        if (isQuestionContext(text, m.index, m[0].length)) continue;
        if (!accept(m)) continue;
        return m;
    }
    return null;
}

export function evidenceAround(text, index, matchLen) {
    let start = Math.max(0, index - 120);
    let end = Math.min(text.length, index + matchLen + 120);
    // Start at a sentence (else word) boundary and end on a word boundary, so
    // quotes never open mid-token ("/13 (priority) …").
    const head = text.slice(start, index);
    const sentence = head.lastIndexOf('. ');
    if (start > 0) start = sentence !== -1 ? start + sentence + 2 : start + Math.max(0, head.indexOf(' ') + 1);
    const tail = text.slice(index + matchLen, end);
    if (end < text.length) {
        const stop = tail.search(/[.!?](?:\s|$)/);
        end = stop !== -1 ? index + matchLen + stop + 1 : index + matchLen + Math.max(0, tail.lastIndexOf(' '));
    }
    return text
        .slice(start, end)
        .replace(/\s+\.(?=\s|$)/g, '.') // block-boundary separators from pageText
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
}

/**
 * The sentence containing [index, index+len), capped at `cap` chars each side.
 * Bounded by sentence punctuation — a fixed character window crossed into the
 * next sentence and read a hacker deadline as a mentor one in testing.
 */
export function clauseAround(text, index, len, cap = 140) {
    const lo = Math.max(0, index - cap);
    const before = text.slice(lo, index);
    const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf(' | '));
    const start = cut === -1 ? lo : lo + cut + 2;
    const after = text.slice(index + len, index + len + cap);
    const endRel = after.search(/[.!?](?:\s|$)| \| /);
    const end = endRel === -1 ? index + len + after.length : index + len + endRel + 1;
    return { start, end, text: text.slice(start, end) };
}

const HACKER_WORD = /\b(?:hackers?|participants?|attendees?|students?|general\s+applications?|hacker\s+applications?|teams?)\b/i;
const ROLE_WORD = /\b(?:mentors?|volunteers?|judges?|sponsors?|sponsorships?|organi[sz]ers?|organi[sz]ing\s+team|speakers?|workshop\s+hosts?|exhibitors?|partners?|recruiters?|staff)\b/i;

/** A statement about a non-hacker role (mentor/volunteer/…) — never hacker-application evidence. */
function isRoleOnly(clause) {
    return ROLE_WORD.test(clause) && !HACKER_WORD.test(clause);
}

/** A clause that names an earlier edition's year — last year's "closed" says nothing about this one. */
function mentionsPastYear(clause, anchorYear) {
    for (const m of clause.matchAll(/\b(20\d{2})\b/g)) {
        if (parseInt(m[1], 10) < anchorYear) return true;
    }
    return false;
}

/* ---- application status ---------------------------------------------------- */

const CLOSED_RES = [
    /\b(?:hacker\s+|participant\s+|general\s+)?applications?\s+(?:for\s+(?:[^.]|\.\d){1,50}?\s+)?(?:are\s+|is\s+|have\s+|has\s+)?(?:now\s+|officially\s+)?closed\b/i,
    /\bregistrations?\s+(?:for\s+(?:[^.]|\.\d){1,50}?\s+)?(?:is\s+|are\s+|has\s+|have\s+)?(?:now\s+|officially\s+)?closed\b/i,
    /\bno\s+longer\s+accepting\s+(?:applications|registrations|responses|submissions)\b/i,
    /\b(?:the\s+)?(?:application\s+|registration\s+)?deadline\s+has\s+passed\b/i,
    /\bwe(?:'|’)?ve\s+reached\s+(?:full\s+)?capacity\b|\bwe\s+have\s+reached\s+(?:full\s+)?capacity\b/i,
    /\b(?:applications?|registrations?)\s+(?:are\s+|is\s+)?(?:now\s+)?full\b/i,
    /\bwaitlist\s+only\b/i,
    /\bjoin\s+the\s+wait\s?list\b/i,
];
const WAITLIST_RE = /\bwait\s?list\b/i;
const NOT_YET_RES = [
    /\bapplications?\s+(?:will\s+)?open(?:s|ing)?\s+(?:later|soon|in\s|on\s|this\s|next\s)/i,
    /\bregistrations?\s+(?:will\s+)?open(?:s|ing)?\s+(?:later|soon|in\s|on\s|this\s|next\s)/i,
    /\bapplications?[^.]{0,40}coming\s+soon\b/i,
    /\bstay\s+tuned[^.]{0,60}(?:appl|regist)/i,
    /\bnotified\s+when\s+(?:applications?|registrations?)\s+open\b/i,
    /\bapplications?\s+(?:are\s+)?not\s+(?:yet\s+)?open\b/i,
];
const OPEN_RES = [
    /\b(?:hacker\s+|participant\s+|general\s+)?applications?\s+(?:are\s+|is\s+)?(?:now\s+|officially\s+)?open\b(?!\s+(?:soon|later|in\b|on\b))/i,
    /\bregistrations?\s+(?:is\s+|are\s+)?(?:now\s+|officially\s+)?open\b(?!\s+(?:soon|later|in\b|on\b))/i,
    /\bsign\s?-?ups?\s+(?:are\s+)?(?:now\s+)?open\b/i,
    /\bnow\s+accepting\s+(?:hacker\s+)?applications\b/i,
];
/** CTAs: persist after the application closes, so they only mean "check the portal". */
const CTA_RES = [/\bapply\s+(?:now|here|today)\b/i, /\bregister\s+now\b/i];
const ROLLING_RE = /\brolling\s+(?:basis|admissions?|acceptances?|review)\b/i;

/**
 * Hacker-application status of a page. Precedence is deliberate statements
 * first — closed → not_yet → open — with role-only clauses and clauses about a
 * past edition ignored. Returns every deadline tier found as well.
 */
export function classifyApplication(text, anchorDate) {
    const anchorYear = parseInt(String(anchorDate).slice(0, 4), 10);
    const valid = (m) => {
        const clause = clauseAround(text, m.index, m[0].length).text;
        return !isRoleOnly(clause) && !mentionsPastYear(clause, anchorYear);
    };
    const deadlines = extractDeadlines(text, anchorDate);
    const rolling = ROLLING_RE.test(text);
    let ctaSeen = false;
    for (const re of CTA_RES) if (firstStatementMatch(text, re, valid)) ctaSeen = true;

    for (const [status, res] of [['closed', CLOSED_RES], ['not_yet', NOT_YET_RES], ['open', OPEN_RES]]) {
        for (const re of res) {
            const m = firstStatementMatch(text, re, valid);
            if (m) {
                const clause = clauseAround(text, m.index, m[0].length).text;
                return {
                    status,
                    deadlines,
                    rolling,
                    ctaSeen,
                    waitlist: status === 'closed' && WAITLIST_RE.test(clause),
                    evidence: evidenceAround(text, m.index, m[0].length),
                };
            }
        }
    }
    return { status: 'unknown', deadlines, rolling, ctaSeen, waitlist: false };
}

/* ---- deadlines ------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const monthNumber = (name) => MONTHS[name.trim().slice(0, 3).toLowerCase()] ?? null;
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const MONTH_NAME = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_TOKEN = new RegExp(
    [
        // Month-name: "September 25th", "Sept. 20", "Nov 2, 2026"
        `\\b(${MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(20\\d{2})\\b)?`,
        // Numeric North-American M/D[/YY[YY]]: "9/13", "09/20/2026"
        `(?<![\\d/])(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{4}|\\d{2}))?(?![\\d/])`,
        // ISO
        `\\b(20\\d{2})-(\\d{2})-(\\d{2})\\b`,
    ].join('|'),
    'gi',
);

/**
 * Any char except a sentence-ending period: dots inside "hive.hackberkeley.org"
 * or "13.0" must not cut the clause (Cal Hacks' cue sits before a domain).
 */
const IN_CLAUSE = String.raw`(?:[^.!?]|[.!?](?=\S))`;
const cue = (head, gap, tail) => new RegExp(String.raw`\b(?:${head})\b${IN_CLAUSE}{0,${gap}}?\b(?:${tail})\b`, 'i');

/** Application-deadline cue in the text before a date (same clause). */
const CUE_RES = [
    cue(String.raw`apply|applications?|apps|registrations?|register|sign\s?-?ups?|sign\s+up`, 90,
        String.raw`by|due|deadline|close[sd]?|closing|until|through|before|ends?`),
    cue(String.raw`priority|early(?:[\s-]bird)?|regular|general|final|first[\s-]round|second[\s-]round|international|travel`, 40,
        String.raw`deadline|round|applications?|apps|due|close[sd]?|closing`),
    /\bdeadline\b/i,
    cue(String.raw`extended|extension`, 40, String.raw`to|until|through|till`),
    cue(String.raw`visa\s+(?:letter|invitation)s?`, 40, String.raw`by|due|deadline|requests?`),
];
/** Dates in these contexts are about the event itself, not applying to it. */
const NOT_APPLICATION_RE = /\b(?:project\s+submissions?|submissions?\s+(?:are\s+)?due|submissions?\s+deadline|submit\s+(?:your\s+)?projects?|judging|hacking\s+(?:ends|begins|starts)|check[\s-]?in|rsvp|doors\s+open|kick[\s-]?off|opening\s+ceremony|closing\s+ceremony|reimbursement\s+(?:forms?|receipts?|requests?)\s+(?:are\s+)?due|receipts?)\b/i;

const TIER_RES = [
    ['priority', /\b(?:priority|early(?:[\s-]bird)?|first[\s-]round|early\s+decision)\b/i],
    ['international', /\b(?:international|visa|outside\s+(?:the\s+)?(?:u\.?s\.?|us|united\s+states|canada))\b/i],
    ['travel', /\b(?:travel|reimburse\w*|stipends?|bus(?:es)?)\b/i],
    ['regular', /\b(?:regular|general|final|standard|second[\s-]round)\b/i],
];

function tierOf(snippet) {
    for (const [kind, re] of TIER_RES) if (re.test(snippet)) return kind;
    return null;
}

/** The tier word closest to the END of `snippet` (i.e. nearest the date that follows it). */
function nearestTier(snippet) {
    let best = null;
    let bestAt = -1;
    for (const [kind, re] of TIER_RES) {
        for (const m of snippet.matchAll(new RegExp(re.source, 'gi'))) {
            if (m.index > bestAt) {
                best = kind;
                bestAt = m.index;
            }
        }
    }
    return best;
}

const ZONES = [
    [/^(?:e[sd]?t|eastern(?:\s+time)?)$/i, 'America/New_York'],
    [/^(?:p[sd]?t|pacific(?:\s+time)?)$/i, 'America/Los_Angeles'],
    [/^(?:c[sd]?t|central(?:\s+time)?)$/i, 'America/Chicago'],
    [/^(?:m[sd]?t|mountain(?:\s+time)?)$/i, 'America/Denver'],
    [/^(?:aoe|anywhere\s+on\s+earth)$/i, 'Etc/GMT+12'],
    [/^(?:utc|gmt)$/i, 'UTC'],
];
const TIME_RE = /^[\s,]*(?:at\s+|@\s*|by\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*\(?\s*(e[sd]?t|eastern(?:\s+time)?|p[sd]?t|pacific(?:\s+time)?|c[sd]?t|central(?:\s+time)?|m[sd]?t|mountain(?:\s+time)?|aoe|anywhere\s+on\s+earth|utc|gmt)\b\)?)?/i;
const NOON_RE = /^[\s,]*(?:at\s+)?(noon|midnight)\b(?:\s*\(?\s*(e[sd]?t|eastern(?:\s+time)?|p[sd]?t|pacific(?:\s+time)?|c[sd]?t|central(?:\s+time)?|m[sd]?t|mountain(?:\s+time)?|aoe|utc|gmt)\b\)?)?/i;

function zoneOf(abbr) {
    if (!abbr) return undefined;
    for (const [re, tz] of ZONES) if (re.test(abbr.trim())) return tz;
    return undefined;
}

/** Time (+ zone) right after a date: "11:59 PM PT", "at 11:59pm", "11:59PM ET". */
function timeAfter(rest) {
    const n = rest.match(NOON_RE);
    if (n) return { time: n[1].toLowerCase() === 'noon' ? '12:00' : '23:59', tz: zoneOf(n[2]) };
    const m = rest.match(TIME_RE);
    if (!m) return {};
    const hasMeridiem = !!m[3];
    // A bare number after a date ("Sep 13 2 tiers") is not a time.
    if (!hasMeridiem && m[2] === undefined) return {};
    let h = parseInt(m[1], 10);
    const min = m[2] ?? '00';
    if (h > 23 || parseInt(min, 10) > 59) return {};
    if (hasMeridiem) {
        const pm = /^p/i.test(m[3]);
        if (h === 12) h = pm ? 12 : 0;
        else if (pm) h += 12;
    }
    return { time: `${pad(h)}:${min}`, tz: zoneOf(m[4]) };
}

function weekdayBefore(prefix) {
    const m = prefix.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s*$/i);
    return m ? WEEKDAYS[m[1].toLowerCase()] : null;
}

/**
 * Year for a yearless deadline: it precedes the event start, so take the
 * anchor's year unless that lands after the start; a stated weekday breaks
 * ties ("Monday, August 18th" was a 2025 date).
 */
function inferYear(month, day, anchorDate, weekday) {
    const startYear = parseInt(anchorDate.slice(0, 4), 10);
    const candidates = [startYear, startYear - 1].map((y) => `${y}-${pad(month)}-${pad(day)}`);
    const fitting = candidates.filter((c) => c < anchorDate);
    if (weekday !== null) {
        const match = fitting.find((c) => new Date(`${c}T12:00:00Z`).getUTCDay() === weekday);
        if (match) return match;
    }
    return fitting[0] ?? null;
}

function validYmd(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const dt = new Date(`${iso}T12:00:00Z`);
    return dt.getUTCMonth() + 1 === m ? iso : null;
}

/** Whole days between two YYYY-MM-DD strings. */
function daysBetween(a, b) {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const RESTRICTED_RE = /\b(?:[A-Z][\w&]*(?:\s+[A-Z][\w&]*)?\s+students\s+only|students?\s+only|only\s+(?:for|open\s+to)\s+[^.]{0,40}?students|exclusively\s+for\s+[^.]{0,40}?students|for\s+[A-Z][\w&]*(?:\s+[A-Z][\w&]*)?\s+students\s+only)\b/i;

/**
 * Every application deadline on a page, with its tier. A date counts only
 * when its clause carries an application cue (or it is chained to a date that
 * does: "by 9/13 (priority) / 9/20 (regular)"), it falls on or before the
 * event start, and not absurdly long before it (that's an old edition).
 */
export function extractDeadlines(text, anchorDate) {
    if (!anchorDate || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return [];
    const found = [];
    let lastAccepted = null; // { end } — date chaining ("9/13 (priority) / 9/20 (regular)")
    let prevDateEnd = 0;     // tier words before an earlier date don't belong to this one

    for (const m of text.matchAll(DATE_TOKEN)) {
        const idx = m.index;
        const prefix = text.slice(Math.max(0, idx - 16), idx);
        let month;
        let day;
        let year;
        if (m[1]) {
            month = monthNumber(m[1]);
            day = parseInt(m[2], 10);
            year = m[3] ? parseInt(m[3], 10) : null;
        } else if (m[4]) {
            month = parseInt(m[4], 10);
            day = parseInt(m[5], 10);
            year = m[6] ? parseInt(m[6].length === 2 ? `20${m[6]}` : m[6], 10) : null;
        } else {
            year = parseInt(m[7], 10);
            month = parseInt(m[8], 10);
            day = parseInt(m[9], 10);
        }
        const tokenEnd = idx + m[0].length;
        const segmentStart = prevDateEnd;
        prevDateEnd = tokenEnd;
        if (!month || !day) continue;
        // "October 23–25" is the event's date range, not a deadline.
        if (/^\s*[-–—]\s*(?:\d|[A-Z][a-z]{2})/.test(text.slice(tokenEnd, tokenEnd + 8))) continue;

        const clause = clauseAround(text, idx, m[0].length);
        const before = text.slice(clause.start, idx);
        const chained = lastAccepted && idx - lastAccepted.end <= 24 && /^[\s)/,&]*(?:\(?\w+\)?)?[\s)/,&]*(?:and|or|\/|,|&)?[\s(]*$/i.test(text.slice(lastAccepted.end, idx));
        const cue = CUE_RES.some((re) => re.test(before));
        if (!cue && !chained) continue;
        if (NOT_APPLICATION_RE.test(before.slice(-70))) continue;
        // Numeric M/D outside an explicit cue is too ambiguous ("Rooms 3/4").
        if (m[4] && !cue && !chained) continue;
        if (isRoleOnly(clause.text)) continue;

        const iso = year !== null ? validYmd(year, month, day) : (() => {
            const guess = inferYear(month, day, anchorDate, weekdayBefore(prefix));
            return guess && validYmd(parseInt(guess.slice(0, 4), 10), month, day);
        })();
        if (!iso) continue;
        if (iso >= anchorDate) continue;                      // a deadline precedes the event
        if (daysBetween(iso, anchorDate) > 300) continue;     // last edition's text

        const tail = text.slice(idx + m[0].length, idx + m[0].length + 40);
        const { time, tz } = timeAfter(tail);
        // Tier: a trailing "(priority)" beats the nearest leading tier word.
        const paren = tail.match(/^[^()/]{0,30}?\(\s*([^)]{1,30})\)/)?.[1] ?? '';
        const nearBefore = text.slice(Math.max(clause.start, segmentStart, idx - 60), idx);
        const kind = tierOf(paren) ?? nearestTier(nearBefore) ?? 'regular';
        const extension = /\b(?:extended|extension)\b/i.test(nearBefore);
        const restricted = RESTRICTED_RE.test(clause.text) && kind === 'priority';

        found.push({
            kind,
            date: iso,
            ...(time ? { time } : {}),
            ...(tz ? { tz } : {}),
            audience: restricted ? 'restricted' : kind === 'international' ? 'international' : 'all',
            ...(restricted ? { audienceNote: clause.text.match(RESTRICTED_RE)?.[0] } : {}),
            source: 'site',
            evidence: clause.text.replace(/\s+\.(?=\s|$)/g, '.').replace(/\s+/g, ' ').trim().slice(0, 280),
            _extension: extension,
        });
        lastAccepted = { end: idx + m[0].length + (paren ? tail.indexOf(')') + 1 : 0) };
    }

    // One date per tier+audience: an explicit extension wins (and records what
    // it replaced); otherwise priority keeps its earliest date and every other
    // tier its latest (the final close).
    const byTier = new Map();
    for (const d of found) {
        const key = `${d.kind}|${d.audience}`;
        const prev = byTier.get(key);
        if (!prev) {
            byTier.set(key, d);
            continue;
        }
        if (d._extension && !prev._extension) {
            byTier.set(key, { ...d, extendedFrom: prev.date });
        } else if (!prev._extension) {
            const keepEarliest = d.kind === 'priority';
            const winner = keepEarliest ? (d.date < prev.date ? d : prev) : d.date > prev.date ? d : prev;
            byTier.set(key, winner);
        }
    }
    return [...byTier.values()]
        .map((d) => {
            const out = { ...d };
            delete out._extension; // internal marker, never stored
            return out;
        })
        .sort((a, b) => a.date.localeCompare(b.date));
}

/** The final all-audience close — what the legacy single `deadline` field carries. */
export function legacyDeadline(deadlines) {
    const usable = deadlines.filter((d) => d.audience !== 'restricted');
    const regular = usable.filter((d) => d.kind === 'regular' && d.audience === 'all');
    const pool = regular.length ? regular : usable;
    return pool.map((d) => d.date).sort().pop();
}

/* ---- application portals --------------------------------------------------- */

const SOCIAL_HOSTS = /(?:^|\.)(?:instagram\.com|twitter\.com|x\.com|facebook\.com|linkedin\.com|tiktok\.com|youtube\.com|discord\.(?:gg|com)|github\.com|medium\.com|mlh\.(?:io|com)|devpost\.com|google\.com\/maps)$/i;
const FORM_HOSTS = /(?:^|\.)(?:forms\.gle|docs\.google\.com|typeform\.com|tally\.so|lu\.ma|luma\.com|airtable\.com|jotform\.com)$/i;
const PORTAL_PATH = /\/(?:apply|application|applications|register|registration|signup|sign-up|portal|dashboard)\b/i;
const PORTAL_SUBDOMAIN = /^(?:apply|my|portal|hive|register|registration|app|dashboard|trunk|hub)\./i;

/**
 * Candidate HACKER application links on a page, best first. Cross-host links
 * are expected (Cal Hacks → hive.hackberkeley.org); nothing is guessed — a
 * conventional `apply.<site>` can be last year's form.
 */
export function findApplyLinks(html, baseUrl) {
    const base = new URL(baseUrl);
    const scored = new Map();
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
        const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        let url;
        try {
            url = new URL(m[1], baseUrl);
        } catch {
            continue;
        }
        if (!/^https?:$/.test(url.protocol)) continue;
        const host = url.hostname.replace(/^www\./, '');
        if (SOCIAL_HOSTS.test(host) || /google\.com$/.test(host) && !/docs\.google\.com/.test(host)) continue;
        if (url.href.replace(/\/$/, '') === base.href.replace(/\/$/, '')) continue;
        if (ROLE_WORD.test(label) && !HACKER_WORD.test(label)) continue;
        let score = 0;
        if (/\b(?:apply|application|register|registration|sign\s?up)\b/i.test(label)) score += 3;
        if (/\bhackers?\b/i.test(label)) score += 2;
        if (FORM_HOSTS.test(host)) score += 2;
        if (PORTAL_SUBDOMAIN.test(url.hostname)) score += 2;
        if (PORTAL_PATH.test(url.pathname)) score += 1;
        if (score < 3) continue;
        const key = url.href.replace(/\/$/, '');
        scored.set(key, Math.max(scored.get(key) ?? 0, score));
    }
    return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([href]) => href).slice(0, 2);
}

const PORTAL_CLOSED_RES = [
    /\bis\s+no\s+longer\s+accepting\s+responses\b/i,                        // Google Forms
    /\bthis\s+typeform\s+is\s+(?:now\s+)?closed\b/i,                         // Typeform
    /\bthis\s+form\s+is\s+(?:now\s+)?closed\b|\bno\s+longer\s+accepting\s+submissions\b/i, // Tally / generic
    /\bregistration\s+(?:is\s+)?closed\b|\bevent\s+(?:is\s+)?full\b|\bsold\s+out\b/i, // Luma / ticketing
    ...CLOSED_RES,
];
const SIGN_IN_RE = /\b(?:sign\s+in|log\s?in|create\s+an\s+account|continue\s+with\s+(?:google|github|email)|forgot\s+password)\b/i;

/**
 * Closed state of an application portal page. A closed marker is decisive; a
 * clear open statement counts; a sign-in wall (or anything else) is 'unknown'
 * — never 'open', since we cannot see behind it.
 */
export function classifyPortal(text, anchorDate) {
    for (const re of PORTAL_CLOSED_RES) {
        const m = firstStatementMatch(text, re, (mm) => !isRoleOnly(clauseAround(text, mm.index, mm[0].length).text));
        if (m) {
            return {
                status: 'closed',
                waitlist: WAITLIST_RE.test(clauseAround(text, m.index, m[0].length).text),
                evidence: evidenceAround(text, m.index, m[0].length),
            };
        }
    }
    const a = classifyApplication(text, anchorDate);
    if (a.status === 'open' || a.status === 'not_yet') return { status: a.status, waitlist: false, evidence: a.evidence, deadlines: a.deadlines };
    return { status: 'unknown', waitlist: false, signIn: SIGN_IN_RE.test(text), deadlines: a.deadlines };
}

/* ---- travel ---------------------------------------------------------------- */

const TRAVEL_MENTION_RE = /travel|reimburs|stipend|bus(?:es|sing)?\s+(?:from|to|provided)|flight\s+(?:credit|reimburs)/i;
const TRAVEL_NO_RES = [
    // Stemmed verbs ("providing"/"provide"/"provided") — a literal 'provide' missed
    // "we will not be providing any travel reimbursements" (seen live, uofthacks.com).
    /(?:no|not|unable\s+to|cannot|can'?t|won'?t|do(?:es)?\s+not)\s+(?:be\s+)?[^.]{0,40}?(?:reimburs|cover|provid|offer)\w*[^.]{0,40}?travel/i,
    /travel[^.]{0,60}?(?:is|are|will\s+be)\s+not\s+(?:covered|reimbursed|provided|offered)/i,
    /travel[^.]{0,60}?(?:is|are)\s+the\s+responsibility/i,
    /no\s+travel\s+(?:reimbursements?|stipends?|grants?|funding|assistance)/i,
    // Contractions: "we aren't able to offer travel reimbursement",
    // "won't be able to reimburse travel" — the alternation above only matches
    // separated words, and hackUMBC's real "no" was slipping through as unknown.
    /n'?t\s+(?:be\s+)?(?:able\s+to\s+)?[^.]{0,20}?(?:reimburs|cover|provid|offer)\w*[^.]{0,50}?travel/i,
    /(?:unfortunately|sadly|regret)[^.]{0,60}?(?:no|not|n'?t)[^.]{0,40}?travel[^.]{0,30}?(?:reimburs|stipend|cover)/i,
];
const TRAVEL_YES_RES = [
    /travel\s+(?:reimbursements?|grants?|stipends?|scholarships?|assistance|funding)[^.]{0,60}?(?:is|are|will\s+be)?\s*(?:available|offered|provided)/i,
    /(?:we\s+(?:will\s+)?(?:offer|provide|cover)|will\s+(?:be\s+)?(?:provid|offer|cover))[^.]{0,40}?travel/i,
    /reimburse[^.]{0,50}?travel/i,
    /travel\s+(?:will\s+be\s+)?reimbursed/i,
    /apply\s+for\s+travel\s+(?:reimbursements?|stipends?|grants?|funding)/i,
];

export function classifyTravel(text) {
    const gate = text.match(TRAVEL_MENTION_RE);
    if (!gate) return { status: 'unknown' }; // silence is never a 'no'
    for (const [status, res] of [['no', TRAVEL_NO_RES], ['yes', TRAVEL_YES_RES]]) {
        for (const re of res) {
            const m = firstStatementMatch(text, re);
            if (m) {
                const evidence = evidenceAround(text, m.index, m[0].length);
                const amountM = evidence.match(/(?:up\s+to\s+|maximum\s+of\s+)?\$\s?\d{2,4}/i);
                return { status, amount: amountM ? amountM[0].replace(/\s+/g, ' ') : undefined, evidence };
            }
        }
    }
    return { status: 'unknown', evidence: evidenceAround(text, gate.index, gate[0].length) };
}

/* ---- override lookup ------------------------------------------------------- */

/**
 * Curated override for a host. Exact host first; the registrable domain only
 * for per-edition YEAR subdomains (2026.knighthacks.org). A blanket
 * parent-domain fallback handed HackGT's travel policy to the Georgia-Tech-only
 * sprout.hack.gt and would leak to any university subdomain.
 */
export function overrideFor(overrides, host) {
    if (overrides[host]) return overrides[host];
    const labels = host.split('.');
    if (labels.length > 2 && /^(?:www|20\d{2})$/.test(labels[0])) {
        return overrides[labels.slice(1).join('.')] ?? overrides[labels.slice(-2).join('.')];
    }
    return undefined;
}

/**
 * Curated deadlines for the edition starting on `eventDate` — pinned to one
 * edition (± 3 days of `eventStart`) so they can't rot into next year's
 * listing. Returns [] when no edition block matches.
 */
export function curatedDeadlines(override, eventDate) {
    for (const ed of override?.editions ?? []) {
        if (!ed?.eventStart || !Array.isArray(ed.deadlines)) continue;
        if (Math.abs(daysBetween(ed.eventStart, eventDate)) > 3) continue;
        return ed.deadlines
            .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && ['priority', 'regular', 'international', 'travel'].includes(d.kind))
            .map((d) => ({
                kind: d.kind,
                date: d.date,
                ...(d.time ? { time: d.time } : {}),
                ...(d.tz ? { tz: d.tz } : {}),
                audience: d.audience ?? 'all',
                ...(d.audienceNote ? { audienceNote: d.audienceNote } : {}),
                source: 'curated',
                ...(d.evidence ? { evidence: String(d.evidence).slice(0, 280) } : {}),
            }));
    }
    return [];
}

/**
 * Merge a fresh read into the stored application record: observation
 * timestamps carry forward (an open seen last week stays the last-seen-open
 * until something new is seen), curated tiers win over site tiers of the same
 * kind, and the legacy single deadline is recomputed.
 */
export function mergeApplication(prevEnrichment, read, curated, nowIso) {
    const prev = prevEnrichment?.application;
    // Legacy records only have status + the enrichment-level checkedAt.
    const prevOpen = prev?.openSeenAt ?? (prev?.status === 'open' ? prevEnrichment?.checkedAt : undefined);
    const prevClosed = prev?.closedSeenAt ?? (prev?.status === 'closed' ? prevEnrichment?.checkedAt : undefined);
    const openSeenAt = read.status === 'open' ? nowIso : prevOpen;
    const closedSeenAt = read.status === 'closed' ? nowIso : prevClosed;
    const siteDeadlines = read.deadlines ?? [];
    const curatedKeys = new Set(curated.map((d) => `${d.kind}|${d.audience}`));
    const deadlines = [...curated, ...siteDeadlines.filter((d) => !curatedKeys.has(`${d.kind}|${d.audience}`))];
    const deadline = legacyDeadline(deadlines);
    return {
        status: read.status,
        ...(deadline ? { deadline } : {}),
        ...(read.evidence ? { evidence: read.evidence } : {}),
        ...(deadlines.length ? { deadlines } : {}),
        ...(read.rolling ? { rolling: true } : {}),
        ...(read.waitlist ? { waitlist: true } : {}),
        ...(read.portal ? { portal: read.portal } : {}),
        // Raw-driver writes serialize undefined as null — spread only what exists.
        ...(openSeenAt ? { openSeenAt } : {}),
        ...(closedSeenAt ? { closedSeenAt } : {}),
    };
}

/* ---- scheduling (state-driven cadence, ADR-029) ---------------------------- */

/** Soonest still-future deadline date in a stored application record (any tier). */
export function nextDeadline(app, today) {
    return (app?.deadlines ?? (app?.deadline ? [{ date: app.deadline }] : []))
        .map((d) => d.date)
        .filter((d) => d >= today)
        .sort()[0];
}

/** Most recent past deadline, for the day-after "was it extended?" check. */
function lastPassedDeadline(app, today) {
    return (app?.deadlines ?? (app?.deadline ? [{ date: app.deadline }] : []))
        .map((d) => d.date)
        .filter((d) => d < today)
        .sort()
        .pop();
}

/**
 * Re-check interval for a host's stored application state, in hours:
 *   open/unknown with a deadline ≤ 7 d, or with none known → 24
 *   not_yet → 48 · open with a deadline further out → 72
 *   closed → 168 (catches extensions) · failed fetches → 168 backoff
 * plus a one-off check the day after any known deadline.
 */
export function recheckHours(enrichment, today) {
    if (!enrichment?.checkedAt) return 0;
    if (enrichment.fetchStatus && enrichment.fetchStatus !== 'ok') return 168;
    const app = enrichment.application ?? {};
    const next = nextDeadline(app, today);
    const lastPassed = lastPassedDeadline(app, today);
    if (lastPassed && daysBetween(lastPassed, today) === 1) return 12;
    if (app.status === 'closed') return 168;
    if (app.status === 'not_yet') return 48;
    if (!next) return 24;
    return daysBetween(today, next) <= 7 ? 24 : 72;
}

/** Urgency key for ordering stale hosts: nearest deadline first, then live states, then event date. */
export function urgencyKey(docs, today) {
    const nexts = docs.map((d) => nextDeadline(d.enrichment?.application, today)).filter(Boolean).sort();
    const states = docs.map((d) => d.enrichment?.application?.status ?? 'unknown');
    const live = states.some((s) => s === 'open' || s === 'not_yet') ? 0 : 1;
    const start = docs.map((d) => d.date).sort()[0] ?? '9999-12-31';
    return `${nexts[0] ?? '9999-12-31'}|${live}|${start}`;
}
