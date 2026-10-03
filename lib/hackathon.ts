/**
 * Application/travel signal resolution for hackathon events — the single place
 * that merges the scrape-owned fields (Devpost open_state), the enrichment
 * subdocument (site/FAQ/portal heuristics) and curated deadlines into what a
 * viewer should see. Components and the digest render from these results
 * only, never from the raw fields. (ADR-029)
 *
 * Everything here is evaluated at READ time against `now` and against the
 * viewer's applicant profile: a stored status is an observation with an age,
 * not the answer, and which deadline matters depends on who is applying.
 *
 * Pure module — type-only imports — so it runs unchanged in pages, the digest
 * and the node:test suite.
 */
import type { AppDeadline } from '@/database';
import type { EventDoc } from '@/lib/events';

/* ---- Applicant profile ---------------------------------------------------- */

export interface Applicant {
    /** Where the hacker is applying from. OTHER = outside Canada and the U.S. */
    country: 'CA' | 'US' | 'OTHER';
    /** Would need travel reimbursement to attend an out-of-area event. */
    wantsTravel: boolean;
}

/** Site focus is the GTA, so a viewer we know nothing about is applying from Canada. */
export const DEFAULT_APPLICANT: Applicant = { country: 'CA', wantsTravel: false };

/** Cookie the site's "Applying from" control writes; read per request by lib/applicant.ts. */
export const APPLICANT_COOKIE = 'nb_applicant';

export function serializeApplicant(a: Applicant): string {
    return `${a.country}-${a.wantsTravel ? 1 : 0}`;
}

/**
 * Cookie value wins; otherwise the request's IP country (Vercel's
 * `x-vercel-ip-country`) picks the default; otherwise Canada.
 */
export function parseApplicant(cookieValue?: string | null, ipCountry?: string | null): Applicant {
    const m = cookieValue?.match(/^(CA|US|OTHER)-([01])$/);
    if (m) return { country: m[1] as Applicant['country'], wantsTravel: m[2] === '1' };
    const ip = ipCountry?.trim().toUpperCase();
    if (ip === 'CA' || ip === 'US') return { ...DEFAULT_APPLICANT, country: ip };
    if (ip && /^[A-Z]{2}$/.test(ip)) return { ...DEFAULT_APPLICANT, country: 'OTHER' };
    return DEFAULT_APPLICANT;
}

export const APPLICANT_COUNTRY_LABEL: Record<Applicant['country'], string> = {
    CA: 'Canada',
    US: 'the U.S.',
    OTHER: 'outside Canada & the U.S.',
};

/* ---- Time helpers (string dates, lexical compare — invariant I5) ---------- */

const FALLBACK_TZ = 'America/Toronto';

function validZone(tz?: string): string {
    if (!tz) return FALLBACK_TZ;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return tz;
    } catch {
        return FALLBACK_TZ;
    }
}

/** YYYY-MM-DD of `at` in `tz`. */
export function dayIn(tz: string, at: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: validZone(tz), year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
}

/** Minutes east of UTC for `tz` at instant `at` (handles DST). */
function offsetMinutes(tz: string, at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((wall - at.getTime()) / 60_000);
}

/** The UTC instant of wall-clock `date time` in `tz`. */
export function zonedInstant(date: string, time: string, tz: string): Date {
    const zone = validZone(tz);
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const wall = Date.UTC(y, m - 1, d, hh, mm);
    // Two passes settle the offset across a DST boundary.
    let utc = wall - offsetMinutes(zone, new Date(wall)) * 60_000;
    utc = wall - offsetMinutes(zone, new Date(utc)) * 60_000;
    return new Date(utc);
}

function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/* ---- Application state ------------------------------------------------------ */

export interface Due {
    kind: AppDeadline['kind'];
    date: string;
    /** HH:MM when stated, else undefined (the deadline runs to the end of that day). */
    time?: string;
    tz: string;
    /** ISO instant the tier closes. */
    closesAt: string;
    /** Calendar days left, counted in the deadline's own zone: 0 = closes today. */
    daysLeft: number;
    source: AppDeadline['source'];
    audience: AppDeadline['audience'];
    audienceNote?: string;
    evidence?: string;
}

export interface ApplicationState {
    status: 'open' | 'closing_soon' | 'closed' | 'not_yet' | 'unknown';
    /** The date to hit: the priority tier for applicants travelling in, else the hard close. */
    actBy?: Due;
    /** Why `actBy` is an earlier tier than the hard close. */
    actByReason?: 'abroad' | 'travel';
    /** Last applicable deadline — once it passes, applications are closed for this applicant. */
    hardDeadline?: Due;
    /** Every still-open applicable tier, soonest first (includes actBy). */
    upcoming: Due[];
    /** Applicable tiers that have already passed (e.g. priority, while regular is open). */
    passed: Due[];
    /** Tiers shown for context but never used as the viewer's deadline. */
    restricted: Due[];
    /**
     * How the open/closed claim is backed (P3): `deadline` = a future deadline;
     * `verified` = observed open within 48 h; `stale` = last seen open longer ago.
     */
    confidence: 'deadline' | 'verified' | 'stale';
    /** Last time applications were observed open (ISO) — "Open as of …". */
    verifiedAt?: string;
    /** Last time anything checked this event's applications (ISO). */
    checkedAt?: string;
    waitlist: boolean;
    rolling: boolean;
    /** The applicant is applying from another country than the event's. */
    abroad: boolean;
    /** F6: an in-person major close to its start with no deadline published anywhere we read. */
    risk?: 'deadline-unpublished';
}

/** Observations newer than this back an "open" claim on their own (P3). */
const VERIFIED_WINDOW_MS = 48 * 3_600_000;
/** closing_soon threshold, in calendar days. */
export const CLOSING_SOON_DAYS = 7;
/** F6 risk window: majors this close to their start with no published deadline. */
const RISK_WINDOW_DAYS = 84;

/** Hosts whose scrape-owned application fields describe something else for in-person events. */
function isDevpost(url: string): boolean {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return host === 'devpost.com' || host.endsWith('.devpost.com');
    } catch {
        return false;
    }
}

/**
 * Devpost's open_state and submission window describe the PROJECT submission
 * period. For online challenges that is the registration window too; for
 * in-person events it is the event itself, so it says nothing about hacker
 * applications (ADR-029 amends ADR-019). Ignored at read time so stale rows in
 * the DB stop showing "open until the last day of the event" immediately.
 */
function trustsScrapeFields(e: EventDoc): boolean {
    return e.mode === 'online' || !isDevpost(e.url);
}

function eventCountry(e: EventDoc): 'CA' | 'US' | null {
    return e.region === 'CA' || e.region === 'US' ? e.region : null;
}

/** All deadline tiers known for an event, curated beating site-read for the same tier. */
export function collectDeadlines(e: EventDoc): AppDeadline[] {
    const app = e.enrichment?.application;
    const out: AppDeadline[] = [...(app?.deadlines ?? [])];
    if (!app?.deadlines?.length && app?.deadline) {
        // Legacy docs (pre-ADR-029) carry one undifferentiated deadline.
        out.push({ kind: 'regular', date: app.deadline, audience: 'all', source: 'site', evidence: app.evidence });
    }
    if (trustsScrapeFields(e) && e.applicationDeadline) {
        out.push({ kind: 'regular', date: e.applicationDeadline, audience: 'all', source: 'platform' });
    }
    const curatedKinds = new Set(out.filter((d) => d.source === 'curated').map((d) => `${d.kind}|${d.audience}`));
    const seen = new Set<string>();
    return out.filter((d) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return false;
        if (d.source !== 'curated' && curatedKinds.has(`${d.kind}|${d.audience}`)) return false;
        const key = `${d.kind}|${d.audience}|${d.date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function toDue(d: AppDeadline, eventTz: string, now: Date): Due {
    const tz = validZone(d.tz ?? eventTz);
    // No stated time → open through the end of that day in the event's zone
    // (not Toronto's: a PT deadline is still open after Toronto midnight).
    const closes = zonedInstant(d.date, d.time ?? '23:59', tz);
    if (!d.time) closes.setUTCSeconds(59);
    return {
        kind: d.kind,
        date: d.date,
        time: d.time,
        tz,
        closesAt: closes.toISOString(),
        daysLeft: daysBetween(dayIn(tz, now), d.date),
        source: d.source,
        audience: d.audience,
        audienceNote: d.audienceNote,
        evidence: d.evidence,
    };
}

const byClose = (a: Due, b: Due) => a.closesAt.localeCompare(b.closesAt);
const latestIso = (...xs: (string | undefined)[]) =>
    xs.filter((x): x is string => !!x && !Number.isNaN(Date.parse(x))).sort().pop();

/** An in-person "major" worth flagging when its deadline is missing. */
function isMajor(e: EventDoc): boolean {
    return e.source === 'watchlist' || e.enrichment?.source === 'curated' || e.enrichment?.travel?.status === 'yes';
}

/**
 * Resolve an event's application state for one applicant at one instant.
 * Not hackathon-gated: any event with application data resolves the same way;
 * events without any resolve to 'unknown'.
 */
export function applicationState(e: EventDoc, who: Applicant = DEFAULT_APPLICANT, now: Date = new Date()): ApplicationState {
    const app = e.enrichment?.application;
    const tz = validZone(e.timezone);
    const country = eventCountry(e);
    const abroad = country !== null && who.country !== country;

    const all = collectDeadlines(e);
    const restrictedRaw = all.filter((d) => d.audience === 'restricted');
    const applicable = all.filter((d) => {
        if (d.audience === 'restricted') return false;
        if (d.kind === 'travel') return who.wantsTravel || abroad;
        if (d.kind === 'international' || d.audience === 'international') return abroad;
        if (d.audience === 'domestic') return !abroad;
        return true;
    });
    const dues = applicable.map((d) => toDue(d, tz, now)).sort(byClose);
    const nowIso = now.toISOString();
    const upcoming = dues.filter((d) => d.closesAt > nowIso);
    const passed = dues.filter((d) => d.closesAt <= nowIso);

    // Hard close: an international cut-off for someone applying from abroad,
    // else the regular close. Priority and travel tiers never close anything.
    const hardPool = (() => {
        const intl = dues.filter((d) => d.kind === 'international' || d.audience === 'international');
        if (abroad && intl.length) return intl;
        return dues.filter((d) => d.kind === 'regular');
    })();
    const hardDeadline = hardPool.length ? hardPool[hardPool.length - 1] : undefined;
    const hardPassed = !!hardDeadline && hardDeadline.closesAt <= nowIso;

    // Act-by: someone travelling in (abroad, or needing travel money) should
    // hit the earliest still-open priority/travel tier — its early decision is
    // what leaves time to arrange a border crossing or visa, and travel funds
    // often go to the early round. Everyone else works to the hard close.
    let actBy: Due | undefined;
    let actByReason: ApplicationState['actByReason'];
    if (!hardPassed) {
        if (abroad || who.wantsTravel) {
            const early = upcoming.find((d) => d.kind === 'priority' || d.kind === 'travel');
            if (early && (!hardDeadline || early.closesAt < hardDeadline.closesAt)) {
                actBy = early;
                actByReason = abroad ? 'abroad' : 'travel';
            }
        }
        if (!actBy) actBy = hardDeadline && !hardPassed ? hardDeadline : upcoming[0];
    }

    // Observations. Scrape-owned status (Devpost) refreshes nightly, so it is
    // dated by the doc's updatedAt; enrichment carries its own timestamps
    // (legacy docs only have checkedAt + a status).
    const scrape = trustsScrapeFields(e) ? e.applicationStatus : undefined;
    const scrapeAt = e.updatedAt;
    const checkedAt = latestIso(e.enrichment?.checkedAt, app?.checkedAt);
    const openSeenAt = latestIso(
        app?.openSeenAt ?? (app?.status === 'open' ? checkedAt : undefined),
        scrape === 'open' ? scrapeAt : undefined,
    );
    const closedSeenAt = latestIso(
        app?.closedSeenAt ?? (app?.status === 'closed' ? checkedAt : undefined),
        scrape === 'closed' ? scrapeAt : undefined,
    );
    const notYet = scrape === 'not_yet' || (!scrape || scrape === 'unknown' ? app?.status === 'not_yet' : false);

    let status: ApplicationState['status'];
    if (hardPassed) status = 'closed';
    else if (closedSeenAt && (!openSeenAt || closedSeenAt > openSeenAt)) status = 'closed';
    else if (notYet && !openSeenAt) status = 'not_yet';
    else if (openSeenAt || upcoming.length) status = 'open';
    else status = 'unknown';

    if (status === 'open' && actBy && actBy.daysLeft <= CLOSING_SOON_DAYS) status = 'closing_soon';

    const confidence: ApplicationState['confidence'] =
        actBy ? 'deadline' : openSeenAt && now.getTime() - Date.parse(openSeenAt) <= VERIFIED_WINDOW_MS ? 'verified' : 'stale';

    let risk: ApplicationState['risk'];
    const today = dayIn(tz, now);
    if (
        (status === 'open' || status === 'unknown') &&
        all.filter((d) => d.audience !== 'restricted').length === 0 &&
        e.mode !== 'online' &&
        country !== null &&
        e.date >= today &&
        daysBetween(today, e.date) <= RISK_WINDOW_DAYS &&
        isMajor(e)
    ) {
        risk = 'deadline-unpublished';
    }

    return {
        status,
        actBy,
        actByReason,
        hardDeadline,
        upcoming,
        passed,
        restricted: restrictedRaw.map((d) => toDue(d, tz, now)).sort(byClose),
        confidence,
        verifiedAt: openSeenAt,
        checkedAt: latestIso(checkedAt, scrape ? scrapeAt : undefined),
        waitlist: status === 'closed' && !!app?.waitlist,
        rolling: !!app?.rolling,
        abroad,
        risk,
    };
}

/** Attach read-time application state to a list of docs (pages call this once per request). */
export function withApplication<T extends EventDoc>(docs: T[], who: Applicant, now: Date = new Date()): T[] {
    return docs.map((d) => ({ ...d, app: applicationState(d, who, now) }));
}

/** The state carried on a doc, or computed for the default applicant when a caller didn't attach one. */
export function stateOf(e: EventDoc): ApplicationState {
    return e.app ?? applicationState(e);
}

/** Open for this applicant right now (the "Apps open" filter and the digest's gate). */
export function isApplicable(s: ApplicationState): boolean {
    return s.status === 'open' || s.status === 'closing_soon';
}

/* ---- Wording (one place, so the site and the email can't drift) ------------ */

export const KIND_LABEL: Record<AppDeadline['kind'], string> = {
    priority: 'priority',
    regular: 'regular',
    international: 'international',
    travel: 'travel aid',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(ymd: string): string {
    const [, m, d] = ymd.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
}

/** "11:59 PM EDT" when the tier states a time, else undefined (it runs to end of day). */
export function dueTimeLabel(due: Due): string | undefined {
    if (!due.time) return undefined;
    return new Intl.DateTimeFormat('en-US', {
        timeZone: due.tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(due.closesAt));
}

/** "Sep 20, 11:59 PM PDT" — date plus time when stated. */
export function dueWhen(due: Due): string {
    const t = dueTimeLabel(due);
    return t ? `${shortDate(due.date)}, ${t}` : shortDate(due.date);
}

/** "Closes today" / "Closes tomorrow" / "5 days left" / "Sep 28". */
export function dueLabel(due: Due): string {
    if (due.daysLeft <= 0) return 'Closes today';
    if (due.daysLeft === 1) return 'Closes tomorrow';
    if (due.daysLeft <= CLOSING_SOON_DAYS) return `${due.daysLeft} days left`;
    return shortDate(due.date);
}

/** Short status for row/card badges. `tone` maps onto existing tokens only (DESIGN.md: no amber). */
export function applicationBadge(s: ApplicationState): { text: string; sub?: string; tone: 'primary' | 'strong' | 'muted' } | null {
    switch (s.status) {
        case 'closing_soon':
            return { text: s.actBy ? dueLabel(s.actBy) : 'Closing soon', tone: 'strong' };
        case 'open':
            if (s.confidence === 'stale') {
                return { text: 'Apps open?', sub: s.verifiedAt ? `as of ${shortDate(s.verifiedAt.slice(0, 10))}` : undefined, tone: 'muted' };
            }
            return { text: 'Apps open', tone: 'primary' };
        case 'closed':
            return { text: s.waitlist ? 'Waitlist only' : 'Apps closed', tone: 'muted' };
        case 'not_yet':
            return { text: 'Apps soon', tone: 'muted' };
        default:
            return s.risk ? { text: 'No deadline', sub: 'check site', tone: 'muted' } : null;
    }
}

/** One-line deadline phrase for a viewer, e.g. "Apply by Sep 13 (priority — recommended for you) · regular Sep 20". */
export function deadlinePhrase(s: ApplicationState): string | undefined {
    if (!s.actBy) return undefined;
    const main = `Apply by ${shortDate(s.actBy.date)}${s.actBy.kind !== 'regular' ? ` (${KIND_LABEL[s.actBy.kind]})` : ''}`;
    const why =
        s.actByReason === 'abroad'
            ? ' — recommended since you’d travel in from another country'
            : s.actByReason === 'travel'
              ? ' — recommended if you need travel support'
              : '';
    const rest = s.upcoming
        .filter((d) => d !== s.actBy)
        .map((d) => `${KIND_LABEL[d.kind]} ${shortDate(d.date)}${d.kind === 'priority' && !s.actByReason ? ' for an early decision' : ''}`);
    const passedPriority = s.passed.find((d) => d.kind === 'priority');
    const notes = [...rest, ...(passedPriority && s.actBy.kind === 'regular' ? ['priority passed'] : [])];
    return `${main}${why}${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
}

/** P3 wording for an open claim backed only by an old observation. */
export function staleNote(s: ApplicationState): string | undefined {
    if ((s.status === 'open' || s.status === 'closing_soon') && s.confidence === 'stale') {
        return s.verifiedAt ? `Open as of ${shortDate(s.verifiedAt.slice(0, 10))} — confirm on the event site` : 'Last seen open — confirm on the event site';
    }
    return undefined;
}

export const RISK_NOTE =
    'Deadline not published where we can read it. Majors like this usually close 5–11 weeks before the event — check now.';

/* ---- Travel ----------------------------------------------------------------- */

export interface TravelSignal {
    status: 'yes' | 'no' | 'unknown';
    amount?: string;
    evidence?: string;
    checkedAt?: string;
    curated: boolean;
    /** 'prior-edition' = seen at a past edition, not confirmed for this one. */
    basis?: 'current' | 'prior-edition';
    year?: number;
    /** Ready-to-render phrase — keeps every surface wording this the same way. */
    label: string;
}

/**
 * Travel support for in-person North-American hackathons. Null = don't render
 * anything (not a hackathon / online / outside US+CA). 'unknown' is a real
 * state for US events ("not listed — check the site"); for CA events only a
 * known yes/no is worth a row (most CA events are local to the audience).
 */
export function travelSignal(e: EventDoc): TravelSignal | null {
    if (e.category !== 'hackathon' || e.mode === 'online') return null;
    if (e.region !== 'US' && e.region !== 'CA') return null;
    const t = e.enrichment?.travel;
    const status = t?.status ?? 'unknown';
    const prior = t?.basis === 'prior-edition';
    const signal: TravelSignal = {
        status,
        amount: t?.amount,
        evidence: t?.evidence,
        checkedAt: e.enrichment?.checkedAt,
        curated: e.enrichment?.source === 'curated',
        basis: t?.basis,
        year: t?.year,
        // Never state a past edition's policy as this year's commitment.
        label:
            status === 'yes'
                ? prior
                    ? `Travel reimbursement offered in ${t?.year ?? 'past years'} — not yet confirmed for this edition`
                    : `Travel reimbursement offered${t?.amount ? ` · ${t.amount}` : ''}`
                : status === 'no'
                  ? prior
                      ? `No travel reimbursement in ${t?.year ?? 'past years'}`
                      : 'No travel reimbursement'
                  : 'Travel support not listed — check the event site',
    };
    if (e.region === 'CA' && signal.status === 'unknown') return null;
    return signal;
}
