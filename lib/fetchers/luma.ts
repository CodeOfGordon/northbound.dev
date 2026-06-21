/**
 * Luma via its public, unauthenticated JSON API (api.lu.ma) — no Apify needed.
 *  - api.lu.ma/url?url=<slug>                resolves a slug to a discover-place or calendar
 *  - discover/get-paginated-events           upcoming events for a city discovery page
 *  - calendar/get-items?period=future        upcoming events for a (company/community) calendar
 * Verified live 2026-06-10; entries embed the event plus calendar/hosts/ticket context.
 */
import { getJSON } from './util';
import { LUMA_CITY_SLUGS, LUMA_HACKATHON_CATEGORIES, MAX_ITEMS } from './config';
import { isRelevant } from './relevance';

const API = 'https://api.lu.ma';

/* eslint-disable @typescript-eslint/no-explicit-any */
type LumaEntry = { event?: any; calendar?: any; hosts?: any[]; ticket_info?: any };

/** Flattened raw item: the event object + its entry-level context. */
export type LumaRaw = any;

function flatten(entries: LumaEntry[]): LumaRaw[] {
    return entries
        .filter((e) => e?.event?.name && e.event.start_at)
        .map((e) => ({ ...e.event, calendar: e.calendar, hosts: e.hosts, ticket_info: e.ticket_info }));
}

async function calendarEvents(calendarApiId: string): Promise<LumaRaw[]> {
    const res = await getJSON<{ entries: LumaEntry[] }>(
        `${API}/calendar/get-items?calendar_api_id=${calendarApiId}&period=future&pagination_limit=${MAX_ITEMS}`,
    );
    return flatten(res.entries ?? []);
}

async function discoverEvents(placeApiId: string): Promise<LumaRaw[]> {
    const res = await getJSON<{ entries: LumaEntry[] }>(
        `${API}/discover/get-paginated-events?discover_place_api_id=${placeApiId}&pagination_limit=${MAX_ITEMS}`,
    );
    return flatten(res.entries ?? []);
}

async function categoryEvents(categoryApiId: string): Promise<LumaRaw[]> {
    const res = await getJSON<{ entries: LumaEntry[] }>(
        `${API}/discover/get-paginated-events?discover_category_api_id=${categoryApiId}&pagination_limit=${MAX_ITEMS}`,
    );
    return flatten(res.entries ?? []);
}

/** Fetch upcoming events for a Luma slug (city page or calendar) or a direct calendar id. */
export async function fetchLumaEntries(ref: { slug?: string; calendarApiId?: string }): Promise<LumaRaw[]> {
    if (ref.calendarApiId) return calendarEvents(ref.calendarApiId);

    const resolved = await getJSON<{ kind: string; data: any }>(
        `${API}/url?url=${encodeURIComponent(ref.slug!)}`,
    );
    if (resolved.kind === 'discover-place') return discoverEvents(resolved.data.place.api_id);
    if (resolved.kind === 'calendar') return calendarEvents(resolved.data.calendar.api_id);
    throw new Error(`Luma slug "${ref.slug}" resolved to unsupported kind "${resolved.kind}"`);
}

/** Source fetcher: city discovery feeds, deduped, upcoming + relevance-filtered. */
export async function fetchLuma(): Promise<unknown[]> {
    const perCity = await Promise.all(
        LUMA_CITY_SLUGS.map(async (slug) => {
            try {
                return await fetchLumaEntries({ slug });
            } catch (e) {
                console.warn(`luma: city "${slug}" skipped — ${(e as Error).message}`);
                return [];
            }
        }),
    );

    const seen = new Set<string>();
    const now = Date.now();
    return perCity.flat().filter((raw) => {
        if (seen.has(raw.api_id)) return false;
        seen.add(raw.api_id);
        if (new Date(raw.start_at).getTime() < now) return false;
        return isRelevant(`${raw.name} ${raw.calendar?.name ?? ''}`);
    });
}

/** lu.ma has no hackathon category, so hackathons hide in AI/Tech — name-match them. */
const HACKATHON_NAME = /\b(hackathons?|buildathon|hack[ -]?(night|fest|day|lab|sprint|week(end)?)|hack the)\b/i;

/**
 * Hackathon source contribution: lu.ma AI + Tech discover feeds, kept to
 * hackathon-named events that are virtual or in CA/US (the global feeds surface
 * Toronto/NYC hackathons the city feeds miss). Tagged `_provider:'luma'` so the
 * normalizer reuses the verified Luma mapper. No description on discover entries —
 * the mapper's fallback handles that.
 */
export async function fetchLumaHackathons(): Promise<unknown[]> {
    const perCategory = await Promise.all(
        LUMA_HACKATHON_CATEGORIES.map(async (cat) => {
            try {
                return await categoryEvents(cat);
            } catch (e) {
                console.warn(`luma-hackathons: category "${cat}" skipped — ${(e as Error).message}`);
                return [];
            }
        }),
    );

    const seen = new Set<string>();
    const now = Date.now();
    return perCategory.flat().filter((raw) => {
        if (seen.has(raw.api_id)) return false;
        seen.add(raw.api_id);
        if (new Date(raw.start_at).getTime() < now) return false;
        if (!HACKATHON_NAME.test(raw.name ?? '')) return false;
        const cc = String(raw.geo_address_info?.country_code ?? '').toUpperCase();
        const virtual = raw.location_type === 'virtual';
        if (!virtual && cc !== 'US' && cc !== 'CA') return false;
        raw._provider = 'luma';
        raw._company = raw.calendar?.name ?? raw.hosts?.[0]?.name; // preserve organizer
        return true;
    });
}
