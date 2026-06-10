/**
 * Meetup via the easyapi/meetup-events-scraper Apify actor.
 * All search URLs go into ONE run — the actor charges a flat fee per start
 * ($0.09) plus per result, so batching searches is the cheap shape.
 */
import { runActor } from './apify';
import { MAX_ITEMS, MEETUP_SEARCH_URLS } from './config';
import { isRelevant } from './relevance';

const ACTOR = 'easyapi/meetup-events-scraper';

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchMeetup(): Promise<unknown[]> {
    // run-option maxItems is the real billing cap (the input field is advisory);
    // 2 GB memory (peak observed ~1.3 GB) halves the per-GB start fee vs the 4 GB default
    const items = await runActor(
        ACTOR,
        { searchUrls: MEETUP_SEARCH_URLS, maxItems: MAX_ITEMS },
        { maxItems: MAX_ITEMS, memoryMb: 2048, timeoutMs: 280_000 },
    );

    const seen = new Set<string>();
    return items.filter((item: any) => {
        if (!item?.id || !item.title || !item.dateTime) return false;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return isRelevant(item.title);
    });
}
