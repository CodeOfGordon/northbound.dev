/**
 * Digest orchestration — builds ONE personalized email per active subscriber
 * from their own filters and their own delivery cursor, then hands the rendered
 * messages to the GitHub Actions runner, which does the actual Gmail SMTP send
 * (Vercel blocks outbound SMTP). State advances only after the runner confirms
 * a successful send — at-least-once: a failure means the same digest is retried
 * next run, never silently dropped. (ADR-025/026)
 *
 * Sections per subscriber:
 *   A "New events for you"   — created since their cursor, matching their rules
 *   B "Applications now open" — hackathons open and not yet announced to THEM
 *   C "Deadlines approaching" — application deadlines 7/3/1 days out (stateless)
 */
import 'server-only';
import { Event, Subscriber, DigestMeta, FREQUENCY_DAYS } from '@/database';
import { matchEvent, rulesForSubscriber, type EventLike, type InterestRule } from '@/lib/notify/match';
import { renderDigest, type DigestItem, type DigestSections } from '@/lib/notify/email';
import { todayInToronto } from '@/lib/events';
import { addDaysISO, monthDay } from '@/lib/format';

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
    /** Bypass the per-subscriber same-day guard. */
    force?: boolean;
    /** Compose without advancing cursors (testing). */
    dryRun?: boolean;
    /** confirm: the cursor compose returned. */
    cursor?: string;
    /** confirm: which subscribers were delivered, and what was announced to them. */
    results?: { subscriberId: string; openIds?: string[]; messageId?: string }[];
    /** compose: the address the runner will send from (used in List-Unsubscribe). */
    sender?: string;
}

export interface DigestMessage {
    subscriberId: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
    /** Event ids announced as "applications open" — stamped on confirm. */
    openIds: string[];
    counts: { newEvents: number; appsOpen: number; deadlines: number };
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

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Resolved application deadline — scrape field wins, else enrichment. */
const deadlineOf = (d: any): string | undefined => d.applicationDeadline ?? d.enrichment?.application?.deadline;
const isOpen = (d: any): boolean =>
    d.applicationStatus === 'open' || (d.applicationStatus == null && d.enrichment?.application?.status === 'open');

/** Email wording mirrors the site: a past edition is never stated as this year's policy. */
function travelNote(d: any): string | undefined {
    const t = d.enrichment?.travel;
    if (!t || t.status !== 'yes') return undefined;
    if (t.basis === 'prior-edition') {
        return `Travel reimbursement offered in ${t.year ?? 'past years'} — not yet confirmed for this edition`;
    }
    return t.amount ? `Travel reimbursement offered · ${t.amount}` : 'Travel reimbursement offered';
}

function toItem(d: any, labels?: string[]): DigestItem {
    return {
        title: d.title, slug: d.slug, date: d.date, endDate: d.endDate,
        city: d.city, country: d.country, region: d.region, mode: d.mode,
        url: d.url, labels, deadline: deadlineOf(d), travel: travelNote(d),
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

export async function runDigest(opts: DigestOptions = {}): Promise<DigestResult> {
    if (opts.mode === 'confirm') return confirmSends(opts);

    const runStarted = new Date();
    const today = todayInToronto();
    const siteUrl = (opts.siteUrl ?? SITE_URL_FALLBACK).replace(/\/$/, '');

    const subs = await Subscriber.find({ status: 'active' }).lean<any[]>();
    if (!subs.length) return { ok: true, messages: [], subscribers: 0, skipped: 'no active subscribers' };

    // Widest window across subscribers — candidates are fetched once and
    // filtered per subscriber in memory (the lists are tens of docs).
    const cursors = subs.map((s) => (s.lastDigestAt ? new Date(s.lastDigestAt).getTime() : runStarted.getTime()));
    const minSince = new Date(Math.min(...cursors));
    const deadlineTargets = [addDaysISO(today, 7), addDaysISO(today, 3), addDaysISO(today, 1)];

    const [created, openDocs, deadlineDocs] = await Promise.all([
        Event.find({ createdAt: { $gt: minSince }, date: { $gte: today } }).lean<any[]>(),
        Event.find({
            category: 'hackathon',
            $and: [
                { $or: [{ applicationStatus: 'open' }, { 'enrichment.application.status': 'open' }] },
                { $or: [{ date: { $gte: today } }, { endDate: { $gte: today } }] },
            ],
        }).lean<any[]>(),
        // Widest window any cadence can ask for (monthly = 30 + 3 margin);
        // each subscriber narrows this to their own window below.
        Event.find({
            category: 'hackathon',
            $or: [
                { applicationDeadline: { $gte: today, $lte: addDaysISO(today, 33) } },
                { 'enrichment.application.deadline': { $gte: today, $lte: addDaysISO(today, 33) } },
            ],
        }).lean<any[]>(),
    ]);

    const messages: DigestMessage[] = [];
    const emptyCursorIds: any[] = [];

    for (const sub of subs) {
        // Cadence guard, which also makes reruns idempotent (daily = same-day guard).
        const freqDays = FREQUENCY_DAYS[sub.frequency ?? 'weekly'] ?? 7;
        if (!opts.force && sub.lastSentAt && daysBetween(torontoDay(new Date(sub.lastSentAt)), today) < freqDays) {
            continue;
        }

        const rules: InterestRule[] = rulesForSubscriber({
            topics: sub.topics ?? [],
            regions: sub.regions ?? [],
            usTravelOnly: !!sub.usTravelOnly,
            minDaysOut: sub.minDaysOut ?? 0,
        });
        if (!rules.length) continue;

        const since = sub.lastDigestAt ? new Date(sub.lastDigestAt) : runStarted; // new subscriber: no history blast
        const notified = new Set<string>((sub.notifiedOpenIds ?? []).map(String));

        // A — new events matching their interests
        const newEvents: DigestItem[] = [];
        for (const d of created) {
            if (new Date(d.createdAt) <= since) continue;
            const labels = matchEvent(d as EventLike, rules, today);
            if (labels.length) newEvents.push(toItem(d, labels));
        }

        // B — applications open, not yet announced to THIS subscriber
        const appsOpen: DigestItem[] = [];
        const openIds: string[] = [];
        for (const d of openDocs) {
            if (notified.has(String(d._id))) continue;
            if (!isOpen(d)) continue; // scrape status overrides a stale enrichment 'open'
            const deadline = deadlineOf(d);
            if (deadline && deadline < today) continue;
            if (!matchEvent(d as EventLike, rules, today).length) continue;
            appsOpen.push(toItem(d));
            openIds.push(String(d._id));
        }

        // C — deadline reminders. Daily readers get the classic 7/3/1 nudges;
        // anyone slower gets everything closing before their NEXT email (plus a
        // 3-day margin), otherwise a weekly reader would hear about a deadline
        // days after it passed.
        const deadlineWindowEnd = freqDays === 1 ? null : addDaysISO(today, freqDays + 3);
        const deadlines: DigestItem[] = [];
        for (const d of deadlineDocs) {
            const deadline = deadlineOf(d);
            if (!deadline) continue;
            const inWindow = deadlineWindowEnd
                ? deadline >= today && deadline <= deadlineWindowEnd
                : deadlineTargets.includes(deadline);
            if (!inWindow) continue;
            if (!isOpen(d)) continue;
            if (!matchEvent(d as EventLike, rules, today).length) continue;
            deadlines.push(toItem(d));
        }

        const counts = { newEvents: newEvents.length, appsOpen: appsOpen.length, deadlines: deadlines.length };
        if (!counts.newEvents && !counts.appsOpen && !counts.deadlines) {
            emptyCursorIds.push(sub._id); // nothing to say — just advance their window
            continue;
        }

        const sections: DigestSections = { newEvents, appsOpen, deadlines };
        const rendered = renderDigest(sections, siteUrl, monthDay(today), {
            email: sub.email,
            unsubscribeUrl: `${siteUrl}/unsubscribe?token=${sub.token}`,
            oneClickUrl: `${siteUrl}/api/unsubscribe?token=${sub.token}`,
            manageUrl: `${siteUrl}/subscribe?token=${sub.token}`,
            // The runner sends as this address; the mailto unsubscribe must match it.
            sender: opts.sender,
        });

        messages.push({
            subscriberId: String(sub._id),
            to: [sub.email],
            ...rendered,
            openIds,
            counts,
            inReplyTo: sub.lastMessageId,
        });
    }

    // Advance the considered-through cursor for subscribers with nothing to send,
    // so their next window stays bounded. (Nothing was delivered, so no markers.)
    if (emptyCursorIds.length && !opts.dryRun) {
        await Subscriber.updateMany({ _id: { $in: emptyCursorIds } }, { $set: { lastDigestAt: runStarted } });
    }

    return { ok: true, messages, cursor: runStarted.toISOString(), subscribers: subs.length };
}

/** The runner delivered these messages — advance each subscriber's state. */
async function confirmSends(opts: DigestOptions): Promise<DigestResult> {
    if (!opts.cursor || Number.isNaN(Date.parse(opts.cursor))) {
        return { ok: false, error: 'confirm: missing/invalid cursor' };
    }
    const at = new Date(opts.cursor);
    const results = opts.results ?? [];

    for (const r of results) {
        const set: Record<string, unknown> = { lastDigestAt: at, lastSentAt: at };
        // Anchor the next digest onto this one so they stay one conversation.
        if (r.messageId) set.lastMessageId = r.messageId;
        const update: Record<string, unknown> = { $set: set };
        if (r.openIds?.length) update.$addToSet = { notifiedOpenIds: { $each: r.openIds } };
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
