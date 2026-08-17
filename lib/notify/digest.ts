/**
 * Digest orchestration — assembles the three sections, sends via Resend, and
 * advances state ONLY on send success (at-least-once: a failure means the same
 * digest is retried next run; a duplicate email to yourself beats a silent
 * miss). State (ADR-021/022):
 *   - meta {key:'digest'}: lastDigestAt = considered-through cursor (advances
 *     on empty runs too, keeping the window bounded); lastSentAt = same-day
 *     rerun guard.
 *   - events.notifiedOpenAt: per-event "applications-open alert already sent"
 *     marker — the digest notifies about the STATE open-and-not-yet-told, so
 *     it self-heals across reruns, rescrapes, and enrichment re-stamps.
 */
import 'server-only';
import { Event, DigestMeta } from '@/database';
import { interests } from '@/config/interests';
import { matchEvent } from '@/lib/notify/match';
import { renderDigest, sendEmail, type DigestItem, type DigestSections } from '@/lib/notify/email';
import { todayInToronto } from '@/lib/events';
import { addDaysISO, monthDay } from '@/lib/format';

export interface DigestOptions {
    /** Compose + send, but skip every state write (cursor, markers). */
    dryRun?: boolean;
    /** Override the cursor window start (dry-run testing), ISO datetime. */
    since?: string;
    /** Bypass the same-day guard. */
    force?: boolean;
}

export interface DigestResult {
    ok: boolean;
    sent: boolean;
    initialized?: boolean;
    skipped?: string;
    error?: string;
    counts?: { newEvents: number; appsOpen: number; deadlines: number };
    cursor?: string;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://northbound.vercel.app';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toItem(d: any, labels?: string[], deadline?: string): DigestItem {
    return {
        title: d.title, slug: d.slug, date: d.date, endDate: d.endDate,
        city: d.city, country: d.country, region: d.region, mode: d.mode,
        url: d.url, labels, deadline,
    };
}

/** Resolved application deadline — scrape field wins, else enrichment. */
const deadlineOf = (d: any): string | undefined => d.applicationDeadline ?? d.enrichment?.application?.deadline;
const isOpen = (d: any): boolean =>
    d.applicationStatus === 'open' || (d.applicationStatus == null && d.enrichment?.application?.status === 'open');

export async function runDigest(opts: DigestOptions = {}): Promise<DigestResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.DIGEST_EMAIL;
    // Not-yet-configured is a soft skip (green job, reason in the step log) —
    // a hard 500 would paint every nightly run red until Resend is set up.
    // A send FAILURE with config present still errors loudly below.
    if (!apiKey || !to) {
        return { ok: true, sent: false, skipped: 'not-configured: RESEND_API_KEY and/or DIGEST_EMAIL unset' };
    }

    const runStarted = new Date();
    const today = todayInToronto();

    const meta = await DigestMeta.findOne({ key: 'digest' }).lean<{ lastDigestAt?: Date; lastSentAt?: Date }>();

    // First run ever: initialize the cursor without emailing history.
    if (!meta?.lastDigestAt && !opts.since) {
        if (!opts.dryRun) {
            await DigestMeta.updateOne(
                { key: 'digest' },
                { $set: { lastDigestAt: runStarted, lastResult: 'initialized' }, $setOnInsert: { key: 'digest' } },
                { upsert: true },
            );
        }
        return { ok: true, sent: false, initialized: true, cursor: runStarted.toISOString() };
    }

    // Same-day guard — workflow reruns must not double-send (deadline section is
    // date-derived and would repeat).
    const lastSentDay = meta?.lastSentAt
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(meta.lastSentAt)
        : null;
    if (lastSentDay === today && !opts.force && !opts.dryRun) {
        return { ok: true, sent: false, skipped: 'already-sent-today' };
    }

    const since = opts.since ? new Date(opts.since) : meta!.lastDigestAt!;

    // Section A — new events since the cursor, upcoming only, matching interests.
    const created = await Event.find({ createdAt: { $gt: since }, date: { $gte: today } }).lean();
    const newEvents: DigestItem[] = [];
    for (const d of created as any[]) {
        const labels = matchEvent(d, interests, today);
        if (labels.length) newEvents.push(toItem(d, labels, deadlineOf(d)));
    }

    // Section B — hackathons whose applications are open and not yet notified.
    const openDocs = await Event.find({
        category: 'hackathon',
        notifiedOpenAt: { $exists: false },
        $and: [
            { $or: [{ applicationStatus: 'open' }, { 'enrichment.application.status': 'open' }] },
            { $or: [{ date: { $gte: today } }, { endDate: { $gte: today } }] },
        ],
    }).lean();
    const appsOpen: DigestItem[] = [];
    const appsOpenIds: unknown[] = [];
    for (const d of openDocs as any[]) {
        if (!isOpen(d)) continue; // scrape says closed/not_yet — overrides enrichment
        const deadline = deadlineOf(d);
        if (deadline && deadline < today) continue; // stale open — deadline passed
        appsOpen.push(toItem(d, undefined, deadline));
        appsOpenIds.push(d._id);
    }

    // Section C — application deadlines exactly 7/3/1 days out (stateless: each
    // event appears on those three days only, no extra markers needed).
    const targets = [addDaysISO(today, 7), addDaysISO(today, 3), addDaysISO(today, 1)];
    const deadlineDocs = await Event.find({
        category: 'hackathon',
        $or: [{ applicationDeadline: { $in: targets } }, { 'enrichment.application.deadline': { $in: targets } }],
    }).lean();
    const deadlines: DigestItem[] = [];
    for (const d of deadlineDocs as any[]) {
        const deadline = deadlineOf(d);
        if (!deadline || !targets.includes(deadline)) continue;
        if (!isOpen(d)) continue;
        deadlines.push(toItem(d, undefined, deadline));
    }

    const sections: DigestSections = { newEvents, appsOpen, deadlines };
    const counts = { newEvents: newEvents.length, appsOpen: appsOpen.length, deadlines: deadlines.length };

    // Nothing to say: advance the considered-through cursor (bounded window), no email.
    if (!counts.newEvents && !counts.appsOpen && !counts.deadlines) {
        if (!opts.dryRun) {
            await DigestMeta.updateOne({ key: 'digest' }, { $set: { lastDigestAt: runStarted, lastResult: 'empty' } });
        }
        return { ok: true, sent: false, counts, cursor: runStarted.toISOString() };
    }

    const { subject, html, text } = renderDigest(sections, SITE_URL, monthDay(today));
    const sendError = await sendEmail({ apiKey, to, subject, html, text });
    if (sendError) return { ok: false, sent: false, error: sendError, counts };

    // Send confirmed — advance state. Best-effort (a bookkeeping failure yields
    // at worst a duplicate tomorrow, never a miss).
    if (!opts.dryRun) {
        try {
            await DigestMeta.updateOne(
                { key: 'digest' },
                { $set: { lastDigestAt: runStarted, lastSentAt: runStarted, lastResult: JSON.stringify(counts) } },
            );
            if (appsOpenIds.length) {
                await Event.updateMany({ _id: { $in: appsOpenIds } }, { $set: { notifiedOpenAt: runStarted } });
            }
        } catch (e) {
            console.warn('digest: bookkeeping write failed —', (e as Error).message);
        }
    }

    return { ok: true, sent: true, counts, cursor: runStarted.toISOString() };
}
