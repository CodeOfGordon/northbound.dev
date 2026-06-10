/**
 * Eventbrite via the parseforge/eventbrite-scraper Apify actor (search mode).
 * One run per city slug; pay-per-result, so MAX_ITEMS is split across cities.
 */
import { runActor } from './apify';
import { EVENTBRITE_CATEGORY, EVENTBRITE_CITIES, MAX_ITEMS } from './config';
import { isRelevant } from './relevance';

const ACTOR = 'parseforge/eventbrite-scraper';

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchEventbrite(): Promise<unknown[]> {
    const perCity = Math.max(5, Math.floor(MAX_ITEMS / EVENTBRITE_CITIES.length));

    const results = await Promise.all(
        EVENTBRITE_CITIES.map(async (city) => {
            try {
                return await runActor(
                    ACTOR,
                    { city, category: EVENTBRITE_CATEGORY, maxItems: perCity },
                    { maxItems: perCity, memoryMb: 1024 }, // run-option maxItems = the real billing cap
                );
            } catch (e) {
                console.warn(`eventbrite: city "${city}" skipped — ${(e as Error).message}`);
                return [];
            }
        }),
    );

    const seen = new Set<string>();
    return results.flat().filter((item: any) => {
        if (!item?.id || !item.title || !item.startDate) return false;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return isRelevant(`${item.title} ${item.summary ?? ''} ${(item.tags ?? []).join(' ')}`);
    });
}
