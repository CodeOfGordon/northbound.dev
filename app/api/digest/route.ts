import { NextResponse, type NextRequest } from 'next/server';
import connectDB from '@/database/mongodb';
import { runDigest } from '@/lib/notify/digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // never cache a mutation endpoint
export const maxDuration = 60;          // a few queries + rendering

/**
 * Digest build endpoint, driven by the GitHub Actions `digest` job after the
 * scrape + enrich jobs (scripts/send-digest.mjs does the Gmail SMTP send —
 * Vercel blocks outbound SMTP).
 *
 *   { mode:'compose', force? }  → one rendered message per active subscriber
 *   { mode:'confirm', cursor, results:[{subscriberId, openIds}] } → record sends
 *
 * Same auth contract as /api/refresh.
 */
export async function POST(request: NextRequest) {
    // Auth — fail closed if the secret is unset
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));

    const results = Array.isArray(body?.results)
        ? body.results
              .filter((r: unknown): r is { subscriberId: string; openIds?: string[] } =>
                  !!r && typeof (r as { subscriberId?: unknown }).subscriberId === 'string')
              .slice(0, 200)
              .map((r: { subscriberId: string; openIds?: unknown }) => ({
                  subscriberId: r.subscriberId,
                  openIds: Array.isArray(r.openIds)
                      ? r.openIds.filter((id): id is string => typeof id === 'string').slice(0, 500)
                      : [],
              }))
        : undefined;

    await connectDB();
    const result = await runDigest({
        // Live origin beats any configured base — see DigestOptions.siteUrl.
        siteUrl: request.nextUrl.origin,
        mode: body?.mode === 'confirm' ? 'confirm' : 'compose',
        force: body?.force === true,
        dryRun: body?.dryRun === true,
        cursor: typeof body?.cursor === 'string' ? body.cursor : undefined,
        results,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
