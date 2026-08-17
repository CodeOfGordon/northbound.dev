import { NextResponse, type NextRequest } from 'next/server';
import connectDB from '@/database/mongodb';
import { runDigest } from '@/lib/notify/digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // never cache a mutation endpoint
export const maxDuration = 60;          // a few queries + one HTTPS call

/**
 * Daily digest trigger — called by the GitHub Actions `digest` job after the
 * scrape + enrich jobs. Body (all optional): { dryRun, since, force } — see
 * lib/notify/digest.ts. Same auth contract as /api/refresh.
 */
export async function POST(request: NextRequest) {
    // Auth — fail closed if the secret is unset
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const strings = (v: unknown, cap: number): string[] | undefined =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, cap) : undefined;

    await connectDB();
    const result = await runDigest({
        dryRun: body?.dryRun === true,
        since: typeof body?.since === 'string' ? body.since : undefined,
        force: body?.force === true,
        mode: body?.mode === 'compose' || body?.mode === 'confirm' ? body.mode : undefined,
        to: strings(body?.to, 50),
        cursor: typeof body?.cursor === 'string' ? body.cursor : undefined,
        openIds: strings(body?.openIds, 500),
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
