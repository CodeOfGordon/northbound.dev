import { NextResponse, type NextRequest } from 'next/server';
import connectDB from '@/database/mongodb';
import { ScrapeMeta } from '@/database';
import { runScrape } from '@/lib/scrape';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // never cache a mutation endpoint
export const maxDuration = 300;         // scrapes are slow; raise the function ceiling

export async function POST(request: NextRequest) {
    // Auth — fail closed if the secret is unset
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Optional body scopes the run, e.g. { "sources": ["luma", "eventbrite"] }
    let sources: string[] | undefined;
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body?.sources)) sources = body.sources.map(String);

    await connectDB();
    const result = await runScrape({ sources });

    // Record run metadata for the "Updated X ago" freshness indicator. Per-source
    // timestamps merge via dot-notation so a single-source run doesn't clobber the
    // others. Best-effort — a bookkeeping failure must not fail the scrape.
    const ranAt = new Date();
    try {
        const set: Record<string, unknown> = {
            lastRunAt: ranAt,
            lastSources: result.sources,
            lastUpserted: result.upsertedCount,
            lastModified: result.modifiedCount,
            lastErrors: result.errors,
        };
        for (const s of result.sources) set[`perSource.${s}`] = ranAt.toISOString();
        await ScrapeMeta.updateOne({ key: 'scrape' }, { $set: set, $setOnInsert: { key: 'scrape' } }, { upsert: true });
    } catch (e) {
        console.warn('refresh: failed to write scrape meta —', (e as Error).message);
    }

    return NextResponse.json({
        ok: true,
        sources: result.sources,
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
        errors: result.errors,
        ranAt: ranAt.toISOString(),
    });
}
