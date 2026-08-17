import { NextResponse, type NextRequest } from 'next/server';
import connectDB from '@/database/mongodb';
import { Subscriber, newSubscriberToken } from '@/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOPICS = ['hackathon', 'company', 'community'];
const REGIONS = ['CA', 'US', 'ONLINE'];
const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pick(value: unknown, allowed: string[]): string[] {
    if (!Array.isArray(value)) return [];
    return allowed.filter((a) => value.includes(a));
}

/**
 * Public signup + preference update for the digest (app/subscribe).
 * With a valid `token` it edits that subscriber; otherwise it creates (or
 * reactivates) one by email. The token is never returned on create — it only
 * travels via the links inside the emails, so a stranger can't submit someone
 * else's address and gain control of their preferences.
 */
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));

    const topics = pick(body?.topics, TOPICS);
    const regions = pick(body?.regions, REGIONS);
    if (!topics.length) return NextResponse.json({ error: 'Pick at least one thing to follow.' }, { status: 400 });
    if (!regions.length) return NextResponse.json({ error: 'Pick at least one region.' }, { status: 400 });

    const usTravelOnly = body?.usTravelOnly === true;
    const frequency = FREQUENCIES.includes(body?.frequency) ? body.frequency : 'weekly';
    const minDaysOutRaw = Number(body?.minDaysOut);
    const minDaysOut = Number.isFinite(minDaysOutRaw) ? Math.min(Math.max(Math.round(minDaysOutRaw), 0), 180) : 21;

    await connectDB();

    // Preference update via emailed link.
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (token) {
        const updated = await Subscriber.findOneAndUpdate(
            { token },
            { $set: { topics, regions, usTravelOnly, minDaysOut, frequency, status: 'active' }, $unset: { unsubscribedAt: '' } },
            { new: true },
        ).lean<{ email: string } | null>();
        if (!updated) return NextResponse.json({ error: 'That link is no longer valid.' }, { status: 404 });
        return NextResponse.json({ ok: true, updated: true, email: updated.email });
    }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
        return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    // Upsert: re-subscribing an unsubscribed address reactivates it and keeps
    // its token (old email links keep working) and its notified history.
    await Subscriber.updateOne(
        { email },
        {
            $set: { topics, regions, usTravelOnly, minDaysOut, frequency, status: 'active' },
            $unset: { unsubscribedAt: '' },
            $setOnInsert: { email, token: newSubscriberToken(), notifiedOpenIds: [] },
        },
        { upsert: true },
    );

    return NextResponse.json({ ok: true, email });
}
