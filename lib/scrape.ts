import { Event, buildFingerprint, generateSlug, normalizeRawEvent } from '@/database';
import { fetchLuma } from './fetchers/luma';
import { fetchEventbrite } from './fetchers/eventbrite';
import { fetchMeetup } from './fetchers/meetup';
import { fetchMlh } from './fetchers/mlh';
import { fetchCompany } from './fetchers/company';

export type ScrapeSource = 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';

type RawFetcher = () => Promise<unknown[]>;

// Each fetcher returns the source's raw items; runScrape normalizes, fingerprints,
// and upserts them. luma/mlh/company hit free public endpoints; eventbrite/meetup
// run paid Apify actors (capped via SCRAPE_MAX_ITEMS, see lib/fetchers/config.ts).
const FETCHERS: Partial<Record<ScrapeSource, RawFetcher>> = {
    luma: fetchLuma,
    eventbrite: fetchEventbrite,
    meetup: fetchMeetup,
    mlh: fetchMlh,
    company: fetchCompany,
};

export interface ScrapeResult {
    sources: ScrapeSource[];
    upsertedCount: number;
    modifiedCount: number;
    errors: string[];
}

/**
 * Run the scrape → normalize → dedup-upsert pipeline for the requested sources
 * (all registered sources when omitted). Caller must have awaited connectDB().
 */
export async function runScrape({ sources }: { sources?: string[] } = {}): Promise<ScrapeResult> {
    const wanted = (Object.keys(FETCHERS) as ScrapeSource[]).filter(
        (s) => !sources || sources.includes(s),
    );

    const result: ScrapeResult = { sources: wanted, upsertedCount: 0, modifiedCount: 0, errors: [] };

    for (const source of wanted) {
        try {
            const raw = await FETCHERS[source]!();
            const ops = raw.flatMap((item) => {
                try {
                    const doc = normalizeRawEvent(item, source);
                    // North-America scope: drop events positively classified outside
                    // Canada/US (region 'INTL'). Online + unknown-location events are
                    // kept — joinable from anywhere / not confirmed foreign.
                    if (doc.region === 'INTL') return [];
                    const fingerprint = buildFingerprint(doc);
                    return [{
                        updateOne: {
                            filter: { fingerprint },
                            // Pre-save hooks don't run on bulkWrite — doc is already
                            // normalized and slug is derived here. Slug includes the
                            // date: recurring series (Reactor, Figma webinars) reuse
                            // titles across dates, and a bare title slug would hit the
                            // unique index and silently drop every later occurrence.
                            update: {
                                $set: doc,
                                $setOnInsert: { fingerprint, slug: generateSlug(`${doc.title} ${doc.date}`) },
                            },
                            upsert: true,
                        },
                    }];
                } catch (e) {
                    result.errors.push(`${source}: skipped item — ${(e as Error).message}`);
                    return [];
                }
            });
            if (!ops.length) continue;

            const res = await Event.bulkWrite(ops, { ordered: false });
            result.upsertedCount += res.upsertedCount;
            result.modifiedCount += res.modifiedCount;
        } catch (e: unknown) {
            // E11000 = two sources raced on the same fingerprint — the event is
            // already stored, so it's a benign dedup outcome, not a failure
            const err = e as { code?: number; result?: { upsertedCount?: number; modifiedCount?: number } };
            if (err.code === 11000 && err.result) {
                result.upsertedCount += err.result.upsertedCount ?? 0;
                result.modifiedCount += err.result.modifiedCount ?? 0;
            } else {
                result.errors.push(`${source}: ${(e as Error).message}`);
            }
        }
    }

    return result;
}
