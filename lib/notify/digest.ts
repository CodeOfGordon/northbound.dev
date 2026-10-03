/**
 * Digest orchestration — builds ONE personalized email per active subscriber
 * from their own filters and their own delivery state, then hands the rendered
 * messages to the GitHub Actions runner, which does the actual Gmail SMTP send
 * (Vercel blocks outbound SMTP). State advances only after the runner confirms
 * a successful send — at-least-once: a failure means the same digest is retried
 * next run, never silently dropped. (ADR-025/026)
 *
 * Application state is resolved per subscriber at compose time (ADR-029):
 * which deadline tier is theirs depends on where they apply from, and "open"
 * is judged against now, not a stored string.
 *
 * Sections per subscriber:
 *   1 "Closing soon — apply now" — every applicable deadline tier inside their
 *     window, priority and regular reminded separately; includes hackathons
 *     whose status is unknown but whose deadline is known
 *   2 "Applications opened"      — open and not yet announced to THEM
 *   3 "Deadline not published"   — in-person majors near their start with no
 *     deadline anywhere we read (once per event)
 *   4 "New for you"              — created since their cursor, matching rules
 *
 * Urgent path: a deadline inside its last 72 h that this subscriber hasn't had
 * a final reminder for goes out even when their weekly/biweekly/monthly digest
 * isn't due — at most one such email a day, deadline items only.
 */
import 'server-only';
import { Event, Subscriber, DigestMeta, FREQUENCY_DAYS } from '@/database';
import { matchEvent, rulesForSubscriber, type EventLike, type InterestRule } from '@/lib/notify/match';
import { renderDigest, type DigestItem, type DigestSections } from '@/lib/notify/email';
import { toEventDoc, todayInToronto, type EventDoc } from '@/lib/events';
import {
    APPLICANT_COUNTRY_LABEL,
    KIND_LABEL,
    RISK_NOTE,
    applicationState,
    dueWhen,
    isApplicable,
    shortDate,
    staleNote,
    type Applicant,
    type ApplicationState,
    type Due,
} from '@/lib/hackathon';
import { monthDay } from '@/lib/format';

export interface DigestOptions {
    /** 'compose' (default): build + render, no send. 'confirm': record a send. */
    mode?: 'compose' | 'confirm';
    /**
     * Absolute base for links in the email. The route passes the live request
     * origin — env/hardcoded fallbacks have been wrong before (the project
     * deploys to northbound-dev.vercel.app), and a wrong base breaks every
     * unsubscribe link, which is a compliance failure, not a cosmetic one.
     */
    siteUrl?: string;
    /** Bypass the per-subscriber cadence guard. */
    force?: boolean;
    /** Compose without advancing cursors (testing). */
    dryRun?: boolean;
    /** confirm: the cursor compose returned. */
    cursor?: string;
    /** confirm: which subscribers were delivered, and what was announced to them. */
    results?: DigestConfirmation[];
    /** compose: the address the runner will send from (used in List-Unsubscribe). */
    sender?: string;
    /** Testing hook: compose as of this instant instead of now. */
    now?: Date;
}

export interface DigestConfirmation {
    subscriberId: string;
    kind?: 'digest' | 'urgent';
    openIds?: string[];
    deadlineKeys?: string[];
    riskIds?: string[];
    messageId?: string;
}

export interface DigestMessage {
    subscriberId: string;
    /** 'urgent' = deadline-only send between regular digests; doesn't move the cadence cursor. */
    kind: 'digest' | 'urgent';
    to: string[];
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
    /** Event ids announced as "applications open" — stamped on confirm. */
    openIds: string[];
    /** Deadline reminders included — stamped on confirm. */
    deadlineKeys: string[];
    /** "Deadline not published" flags included — stamped on confirm. */
    riskIds: string[];
    counts: { newEvents: number; appsOpen: number; deadlines: number; risks: number };
    /** Message-ID of their previous digest — the runner threads onto it. */
    inReplyTo?: string;
}

export interface DigestResult {
    ok: boolean;
    messages?: DigestMessage[];
    cursor?: string;
    subscribers?: number;
    confirmed?: number;
    skipped?: string;
    error?: string;
}

const SITE_URL_FALLBACK = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://northbound-dev.vercel.app').replace(/\/$/, '');

/** Inside this many hours a reminder is the "final" one the urgent path guarantees. */
const FINAL_HOURS = 72;

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Email wording mirrors the site: a past edition is never stated as this year's policy. */
function travelNote(d: EventDoc): string | undefined {
    const t = d.enrichment?.travel;
    if (!t || t.status !== 'yes') return undefined;
    if (t.basis === 'prior-edition') {
        return `Travel reimbursement offered in ${t.year ?? 'past years'} — not yet confirmed for this edition`;
    }
    return t.amount ? `Travel reimbursement offered · ${t.amount}` : 'Travel reimbursement offered';
}

/** "closes today" / "closes tomorrow" / "closes in 5 days". */
function closesIn(due: Due): string {
    if (due.daysLeft <= 0) return 'closes today';
    if (due.daysLeft === 1) return 'closes tomorrow';
    return `closes in ${due.daysLeft} days`;
}

/**
 * The reminder line for one tier, worded for this subscriber:
 *   "Priority deadline Sep 13 — closes in 2 days · recommended since you'd travel in from Canada · regular Sep 20"
 */
export function reminderLine(s: ApplicationState, due: Due, who: Applicant): string {
    const head = `${KIND_LABEL[due.kind][0].toUpperCase()}${KIND_LABEL[due.kind].slice(1)} deadline ${dueWhen(due)} — ${closesIn(due)}`;
    const why =
        due === s.actBy && s.actByReason === 'abroad'
            ? `recommended since you'd travel in from ${APPLICANT_COUNTRY_LABEL[who.country]}`
            : due === s.actBy && s.actByReason === 'travel'
              ? 'recommended if you need travel support'
              : due.kind === 'priority' && !s.actByReason
                ? 'for an early decision'
                : '';
    const others = s.upcoming.filter((d) => d !== due).map((d) => `${KIND_LABEL[d.kind]} ${shortDate(d.date)}`);
    return [head, why, ...others].filter(Boolean).join(' · ');
}

function toItem(d: EventDoc, extra: Partial<DigestItem> = {}): DigestItem {
    return {
        title: d.title, slug: d.slug, date: d.date, endDate: d.endDate,
        city: d.city, country: d.country, region: d.region, mode: d.mode,
        url: d.url, travel: travelNote(d),
        deadline: d.app?.actBy?.date,
        ...extra,
    };
}

/** Toronto calendar date of a timestamp — cadence is counted in calendar days. */
function torontoDay(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
}

/** Whole calendar days between two YYYY-MM-DD strings. */
function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const deadlineKey = (id: string, due: Due, bucket: 'early' | 'final') => `${id}:${due.kind}:${due.date}:${bucket}`;

export function applicantOf(sub: any): Applicant {
    const country = sub.homeCountry === 'US' || sub.homeCountry === 'OTHER' ? sub.homeCountry : 'CA';
    // A subscriber who filters US events to travel-covered ones needs travel money.
    return { country, wantsTravel: !!sub.wantsTravel || !!sub.usTravelOnly };
}

export async function runDigest(opts: DigestOptions = {}): Promise<DigestResult> {
    if (opts.mode === 'confirm') return confirmSends(opts);

    const runStarted = opts.now ?? new Date();
    const today = opts.now ? torontoDay(opts.now) : todayInToronto();
    const siteUrl = (opts.siteUrl ?? SITE_URL_FALLBACK).replace(/\/$/, '');

    const subs = await Subscriber.find({ status: 'active' }).lean<any[]>();
    if (!subs.length) return { ok: true, messages: [], subscribers: 0, skipped: 'no active subscribers' };

    // Widest window across subscribers — candidates are fetched once and
    // filtered per subscriber in memory (the lists are tens to low hundreds).
    const cursors = subs.map((s) => (s.lastDigestAt ? new Date(s.lastDigestAt).getTime() : runStarted.getTime()));
    const minSince = new Date(Math.min(...cursors));

    const [created, hackathons] = await Promise.all([
        Event.find({ createdAt: { $gt: minSince }, date: { $gte: today } }).lean<any[]>(),
        Event.find({
            category: 'hackathon',
            $or: [{ date: { $gte: today } }, { endDate: { $gte: today } }],
        }).lean<any[]>(),
    ]);

    const messages: DigestMessage[] = [];
    const emptyCursorIds: any[] = [];

    for (const sub of subs) {
        const freqDays = FREQUENCY_DAYS[sub.frequency ?? 'weekly'] ?? 7;
        const cadenceDue =
            !!opts.force || !sub.lastSentAt || daysBetween(torontoDay(new Date(sub.lastSentAt)), today) >= freqDays;
        const urgentAllowed =
            sub.urgentDeadlines !== false && (!sub.lastUrgentAt || torontoDay(new Date(sub.lastUrgentAt)) !== today);
        if (!cadenceDue && !urgentAllowed) continue;

        const rules: InterestRule[] = rulesForSubscriber({
            topics: sub.topics ?? [],
            regions: sub.regions ?? [],
            usTravelOnly: !!sub.usTravelOnly,
        });
        if (!rules.length) continue;

        const who = applicantOf(sub);
        const since = sub.lastDigestAt ? new Date(sub.lastDigestAt) : runStarted; // new subscriber: no history blast
        const notifiedOpen = new Set<string>((sub.notifiedOpenIds ?? []).map(String));
        const notifiedKeys = new Set<string>((sub.notifiedDeadlineKeys ?? []).map(String));
        const notifiedRisk = new Set<string>((sub.notifiedRiskIds ?? []).map(String));

        // Hackathons resolved for THIS applicant, and whether they match at all.
        const resolved = hackathons
            .map((raw) => {
                const doc = toEventDoc(raw, who, runStarted);
                const state = doc.app ?? applicationState(doc, who, runStarted);
                const matches = matchEvent(doc as EventLike, rules, { applicationsClosed: state.status === 'closed' }).length > 0;
                return { id: String(raw._id), raw, doc, state, matches };
            })
            .filter((h) => h.matches);

        // 1 — Closing soon. Regular readers: anything closing before their next
        // email (+3 days margin; daily readers: within a week). Every tier is
        // reminded at most twice: once when it enters the window ('early') and
        // once in its final 72 h ('final', which the urgent path guarantees).
        const windowDays = freqDays === 1 ? 7 : freqDays + 3;
        const deadlineItems: DigestItem[] = [];
        const deadlineKeys: string[] = [];
        const urgentItems: DigestItem[] = [];
        const urgentKeys: string[] = [];
        const createdSince = (raw: any) => raw.createdAt && new Date(raw.createdAt) > since;
        for (const h of resolved) {
            if (!isApplicable(h.state)) continue;
            for (const due of h.state.upcoming) {
                const hoursLeft = (Date.parse(due.closesAt) - runStarted.getTime()) / 3_600_000;
                const bucket = hoursLeft <= FINAL_HOURS ? 'final' : 'early';
                const key = deadlineKey(h.id, due, bucket);
                if (notifiedKeys.has(key)) continue;
                const item = toItem(h.doc, { deadlineLabel: reminderLine(h.state, due, who), note: staleNote(h.state) });
                if (due.daysLeft <= windowDays) {
                    deadlineItems.push(item);
                    deadlineKeys.push(key);
                }
                // Urgent: the final 72 h, or a hackathon first seen this late.
                const firstSeenLate = createdSince(h.raw) && due.daysLeft <= 7 && !notifiedKeys.has(deadlineKey(h.id, due, 'early'));
                if (bucket === 'final' || firstSeenLate) {
                    urgentItems.push(item);
                    urgentKeys.push(key);
                }
            }
        }

        // Not due for a regular digest: maybe an urgent deadline-only email.
        if (!cadenceDue) {
            if (urgentAllowed && urgentItems.length) {
                const sections: DigestSections = { deadlines: dedupeItems(urgentItems), appsOpen: [], risks: [], newEvents: [] };
                messages.push(compose(sub, sections, 'urgent', urgentKeys, [], [], siteUrl, today, opts.sender));
            }
            continue;
        }

        // 2 — Applications opened, not yet announced to THIS subscriber. An
        // open claim backed only by a stale observation is not announced (P3).
        const appsOpen: DigestItem[] = [];
        const openIds: string[] = [];
        const closingSlugs = new Set(deadlineItems.map((i) => i.slug));
        for (const h of resolved) {
            if (notifiedOpen.has(h.id) || !isApplicable(h.state) || h.state.confidence === 'stale') continue;
            openIds.push(h.id);
            // Already in "Closing soon" — that row says it's open; don't list it twice.
            if (closingSlugs.has(h.doc.slug)) continue;
            appsOpen.push(toItem(h.doc, { deadlineLabel: h.state.actBy ? reminderLine(h.state, h.state.actBy, who) : undefined }));
        }

        // 3 — Deadline not published (F6), once per event.
        const risks: DigestItem[] = [];
        const riskIds: string[] = [];
        for (const h of resolved) {
            if (h.state.risk !== 'deadline-unpublished' || notifiedRisk.has(h.id)) continue;
            risks.push(toItem(h.doc, { note: RISK_NOTE }));
            riskIds.push(h.id);
        }

        // 4 — New events matching their interests (hackathons not already above).
        const listed = new Set([...deadlineItems, ...appsOpen, ...risks].map((i) => i.slug));
        const newEvents: DigestItem[] = [];
        for (const raw of created) {
            if (new Date(raw.createdAt) <= since) continue;
            const doc = toEventDoc(raw, who, runStarted);
            if (listed.has(doc.slug)) continue;
            const labels = matchEvent(doc as EventLike, rules, { applicationsClosed: doc.app?.status === 'closed' });
            if (!labels.length) continue;
            const s = doc.app;
            newEvents.push(
                toItem(doc, {
                    labels,
                    deadlineLabel: s?.actBy ? reminderLine(s, s.actBy, who) : undefined,
                    note: s?.status === 'not_yet' ? "Applications aren't open yet — we'll tell you when they are" : staleNote(s!),
                }),
            );
        }

        const sections: DigestSections = { deadlines: dedupeItems(deadlineItems), appsOpen, risks, newEvents };
        if (!sections.deadlines.length && !appsOpen.length && !risks.length && !newEvents.length) {
            emptyCursorIds.push(sub._id); // nothing to say — just advance their window
            continue;
        }
        messages.push(compose(sub, sections, 'digest', deadlineKeys, openIds, riskIds, siteUrl, today, opts.sender));
    }

    // Advance the considered-through cursor for subscribers with nothing to send,
    // so their next window stays bounded. (Nothing was delivered, so no markers.)
    if (emptyCursorIds.length && !opts.dryRun) {
        await Subscriber.updateMany({ _id: { $in: emptyCursorIds } }, { $set: { lastDigestAt: runStarted } });
    }

    return { ok: true, messages, cursor: runStarted.toISOString(), subscribers: subs.length };
}

/** Same event + same reminder line once (priority and regular stay separate rows). */
function dedupeItems(items: DigestItem[]): DigestItem[] {
    const seen = new Set<string>();
    return items.filter((i) => {
        const k = `${i.slug}|${i.deadlineLabel ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function compose(
    sub: any,
    sections: DigestSections,
    kind: 'digest' | 'urgent',
    deadlineKeys: string[],
    openIds: string[],
    riskIds: string[],
    siteUrl: string,
    today: string,
    sender?: string,
): DigestMessage {
    const rendered = renderDigest(sections, siteUrl, monthDay(today), {
        email: sub.email,
        unsubscribeUrl: `${siteUrl}/unsubscribe?token=${sub.token}`,
        oneClickUrl: `${siteUrl}/api/unsubscribe?token=${sub.token}`,
        manageUrl: `${siteUrl}/subscribe?token=${sub.token}`,
        // The runner sends as this address; the mailto unsubscribe must match it.
        sender,
        urgent: kind === 'urgent',
    });
    return {
        subscriberId: String(sub._id),
        kind,
        to: [sub.email],
        ...rendered,
        openIds,
        deadlineKeys,
        riskIds,
        counts: {
            newEvents: sections.newEvents.length,
            appsOpen: sections.appsOpen.length,
            deadlines: sections.deadlines.length,
            risks: sections.risks.length,
        },
        inReplyTo: sub.lastMessageId,
    };
}

/** The runner delivered these messages — advance each subscriber's state. */
async function confirmSends(opts: DigestOptions): Promise<DigestResult> {
    if (!opts.cursor || Number.isNaN(Date.parse(opts.cursor))) {
        return { ok: false, error: 'confirm: missing/invalid cursor' };
    }
    const at = new Date(opts.cursor);
    const results = opts.results ?? [];

    for (const r of results) {
        // An urgent send doesn't move the regular cadence — the weekly digest
        // still goes out on schedule.
        const set: Record<string, unknown> = r.kind === 'urgent' ? { lastUrgentAt: at } : { lastDigestAt: at, lastSentAt: at };
        // Anchor the next digest onto this one so they stay one conversation.
        if (r.messageId) set.lastMessageId = r.messageId;
        const update: Record<string, unknown> = { $set: set };
        const add: Record<string, unknown> = {};
        if (r.openIds?.length) add.notifiedOpenIds = { $each: r.openIds };
        if (r.deadlineKeys?.length) add.notifiedDeadlineKeys = { $each: r.deadlineKeys };
        if (r.riskIds?.length) add.notifiedRiskIds = { $each: r.riskIds };
        if (Object.keys(add).length) update.$addToSet = add;
        await Subscriber.updateOne({ _id: r.subscriberId }, update);
    }

    // Run log — observability only; per-subscriber cursors are the real state.
    await DigestMeta.updateOne(
        { key: 'digest' },
        { $set: { lastDigestAt: at, lastSentAt: at, lastResult: `sent:${results.length}` }, $setOnInsert: { key: 'digest' } },
        { upsert: true },
    );

    return { ok: true, confirmed: results.length, cursor: opts.cursor };
}
