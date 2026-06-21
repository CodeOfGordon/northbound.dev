/**
 * Freshness/status reads for the UI. Prefers the `scrape` meta doc the refresh
 * route writes; falls back to the newest event's updatedAt so the "Updated X ago"
 * indicator shows something real even before the first tracked run.
 */
import 'server-only';
import connectDB from '@/database/mongodb';
import { Event, ScrapeMeta } from '@/database';

export interface ScrapeStatus {
    /** Last time the pipeline ran (or, derived, the newest event write). null if no data. */
    lastRunAt: Date | null;
    /** Per-source last-success timestamps, when tracked. */
    perSource: Record<string, string>;
    /** 'tracked' = from the meta doc, 'derived' = inferred from event timestamps. */
    basis: 'tracked' | 'derived' | 'none';
}

const EMPTY: ScrapeStatus = { lastRunAt: null, perSource: {}, basis: 'none' };

export async function getScrapeStatus(): Promise<ScrapeStatus> {
    // This runs in the global Footer, so it renders on every page — including the
    // statically-prerendered /_not-found at build time, where MONGODB_URI may be
    // absent (e.g. on Vercel before env is set) or Atlas unreachable. A freshness
    // read must never crash the page/build: degrade to "no badge" on any failure.
    try {
        await connectDB();

        const meta = await ScrapeMeta.findOne({ key: 'scrape' }).lean<{
            lastRunAt?: Date;
            perSource?: Record<string, string>;
        }>();
        if (meta?.lastRunAt) {
            return { lastRunAt: new Date(meta.lastRunAt), perSource: meta.perSource ?? {}, basis: 'tracked' };
        }

        // Fallback: newest write across events.
        const newest = await Event.findOne({}, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean<{ updatedAt?: Date }>();
        if (newest?.updatedAt) {
            return { lastRunAt: new Date(newest.updatedAt), perSource: {}, basis: 'derived' };
        }

        return EMPTY;
    } catch (e) {
        console.warn('getScrapeStatus: unavailable —', (e as Error).message);
        return EMPTY;
    }
}
