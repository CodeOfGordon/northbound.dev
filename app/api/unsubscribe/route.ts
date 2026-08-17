import { NextResponse, type NextRequest } from 'next/server';
import connectDB from '@/database/mongodb';
import { Subscriber } from '@/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-click unsubscribe (RFC 8058). Mailbox providers POST here directly from
 * the native "Unsubscribe" control in Gmail/Apple Mail — no landing page, no
 * confirmation, honored immediately. The same endpoint backs the button on
 * /unsubscribe. Always answers 200 so a provider never retries or flags the
 * list; an unknown token simply changes nothing.
 */
export async function POST(request: NextRequest) {
    const token =
        request.nextUrl.searchParams.get('token') ??
        (await request.json().catch(() => ({})))?.token;

    if (typeof token !== 'string' || !token) {
        return NextResponse.json({ ok: true, unsubscribed: false });
    }

    await connectDB();
    const res = await Subscriber.updateOne(
        { token },
        { $set: { status: 'unsubscribed', unsubscribedAt: new Date() } },
    );

    return NextResponse.json({ ok: true, unsubscribed: res.matchedCount > 0 });
}

/** Providers that probe with GET get the human page, never a silent mutation. */
export function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    return NextResponse.redirect(new URL(`/unsubscribe?token=${encodeURIComponent(token)}`, request.nextUrl.origin));
}
