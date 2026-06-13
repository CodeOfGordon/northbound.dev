import type { Document } from 'mongoose';
import type { IEvent } from '@/database';
import { deriveTags } from '@/lib/fetchers/relevance';
import { stripHtml } from '@/lib/fetchers/util';
import { classifyRegion, cleanTitle } from '@/lib/fetchers/geo';

type Source = 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';

const DEFAULT_TZ = 'America/Toronto';
const DEFAULT_COUNTRY = 'Canada';
const DEFAULT_CITY = 'Toronto';

/** Wall-clock parts of an instant in a given IANA timezone. */
function partsInZone(d: Date, timeZone: string): { date: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${get('hour')}:${get('minute')}`,
    };
}

const HAS_TIME = /\d{1,2}:\d{2}/;

/**
 * YYYY-MM-DD. Accepts ISO strings, Date-parseable strings, or already-normalized dates.
 * Timestamps are read in `timezone` (the event's zone), NOT UTC — an 8 PM Toronto event
 * with a -04:00 offset must not roll to the next day.
 */
export function normalizeDate(input: string | Date, timezone: string = DEFAULT_TZ): string {
    if (typeof input === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
        if (!HAS_TIME.test(input)) {
            // Date-only string ("June 15, 2026"): Date parses it as local midnight, so
            // read it back with local getters — converting zones would shift the day.
            const d = new Date(input);
            if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${String(input)}`);
    return partsInZone(d, timezone).date;
}

/** HH:MM 24h. Accepts "14:30", "2:30 PM", or an ISO timestamp (read in `timezone`, not UTC). */
export function normalizeTime(input: string | Date, timezone: string = DEFAULT_TZ): string {
    if (input instanceof Date) return partsInZone(input, timezone).time;
    const m = input.trim().match(/^(\d{1,2}):(\d{2})(\s*(AM|PM))?$/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2];
        const period = m[4]?.toUpperCase();
        if (period === 'PM' && h !== 12) h += 12;
        if (period === 'AM' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${min}`;
    }
    const d = new Date(input); // ISO timestamp fallback
    if (isNaN(d.getTime())) throw new Error(`Invalid time: ${input}`);
    return partsInZone(d, timezone).time;
}

const COUNTRY_NAMES: Record<string, string> = {
    ca: 'Canada', us: 'United States', gb: 'United Kingdom',
};

function countryName(code?: string): string {
    if (!code) return DEFAULT_COUNTRY;
    return COUNTRY_NAMES[code.toLowerCase()] ?? code;
}

// Sources spell the same city differently (Montréal/Montreal); canonicalize so the
// city filter — and the fingerprint, which includes city — treats them as one.
const CITY_ALIASES: Record<string, string> = {
    'montréal': 'Montreal',
    'québec': 'Quebec City',
    'quebec': 'Quebec City',
    'québec city': 'Quebec City',
};

function canonicalCity(city: string): string {
    return CITY_ALIASES[city.trim().toLowerCase()] ?? city.trim();
}

/** The schema requires a non-empty description; list APIs don't always provide one. */
function fallbackDescription(title: string, city: string, organizer: string): string {
    return `${title} — hosted by ${organizer} in ${city}. See the event page for full details.`;
}

/** Canonical payload — everything except slug + fingerprint (added at upsert time). */
export type CanonicalEvent = Omit<
    IEvent,
    keyof Document | 'slug' | 'fingerprint' | 'createdAt' | 'updatedAt'
>;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Luma entry mapper, shared by the `luma` city feeds and company Luma calendars.
 * Raw shape (verified live against api.lu.ma, 2026-06-10): the event object plus
 * entry-level calendar / hosts / ticket_info attached by the fetcher.
 */
function mapLumaEvent(raw: any, source: Source, organizerOverride?: string): CanonicalEvent {
    const tz = raw.timezone ?? DEFAULT_TZ;
    const geo = raw.geo_address_info ?? {};
    const online = raw.location_type !== 'offline';
    const city = canonicalCity(geo.city ?? (online ? 'Online' : DEFAULT_CITY));
    const organizer = organizerOverride ?? raw.calendar?.name ?? raw.hosts?.[0]?.name ?? 'Luma';
    const title = String(raw.name).slice(0, 100);
    const text = `${title} ${organizer}`;
    return {
        title,
        description: fallbackDescription(title, city, organizer),
        image: raw.cover_url ?? raw.social_image_url ?? '',
        venue: geo.full_address ?? geo.address ?? geo.sublocality ?? geo.city_state ?? (online ? 'Online' : 'TBA'),
        country: geo.country ?? (online ? 'Online' : DEFAULT_COUNTRY),
        city,
        date: normalizeDate(raw.start_at, tz),
        time: normalizeTime(raw.start_at, tz),
        endDate: raw.end_at ? normalizeDate(raw.end_at, tz) : undefined,
        endTime: raw.end_at ? normalizeTime(raw.end_at, tz) : undefined,
        timezone: tz,
        mode: online ? 'online' : 'offline',
        organizer,
        tags: deriveTags(text),
        url: `https://lu.ma/${raw.url}`,
        source,
        sourceId: raw.api_id,
        isFree: raw.ticket_info?.is_free ?? undefined,
        price: raw.ticket_info?.price != null ? String(raw.ticket_info.price) : undefined,
        category: mapCategory(text),
    };
}

/**
 * Bespoke company-platform adapters (lib/fetchers/companies/) all emit the shared
 * CompanyStdEvent shape, so one mapper covers every platform. Sources are either
 * instant-based (startISO + IANA timezone) or date-only (date/endDate parts, no
 * times — default 09:00 satisfies the schema without inventing precision).
 */
function mapStdCompanyEvent(raw: any): CanonicalEvent {
    const tz = raw.timezone ?? DEFAULT_TZ;
    const online = raw.mode ? raw.mode === 'online' : !!raw.online;
    const city = canonicalCity(raw.city ?? (online ? 'Online' : 'TBA'));
    const organizer = raw._company ?? 'Company';
    const title = stripHtml(String(raw.title)).slice(0, 100);
    const description = stripHtml(raw.description ?? '');
    return {
        title,
        description: (description || fallbackDescription(title, city, organizer)).slice(0, 1000),
        image: raw.image ?? '',
        venue: raw.venue ?? (online ? 'Online' : 'TBA'),
        country: raw.country ?? (online ? 'Online' : 'TBA'),
        city,
        date: raw.date ?? normalizeDate(raw.startISO, tz),
        time: raw.time ?? (raw.startISO ? normalizeTime(raw.startISO, tz) : '09:00'),
        endDate: raw.endDate ?? (raw.endISO ? normalizeDate(raw.endISO, tz) : undefined),
        endTime: raw.endTime ?? (raw.endISO ? normalizeTime(raw.endISO, tz) : undefined),
        timezone: tz,
        mode: raw.mode ?? (online ? 'online' : 'offline'),
        organizer,
        tags: deriveTags(`${title} ${organizer} ${description.slice(0, 200)}`),
        url: raw.url,
        source: 'company',
        sourceId: raw.id != null ? `${raw._provider}:${raw.id}` : undefined,
        isFree: raw.isFree,
        price: raw.price,
        category: raw.category ?? mapCategory(title),
    };
}

/**
 * Map a source-specific raw object to the canonical Event shape, then apply
 * cross-source post-processing: title cleanup and geo classification (canonical
 * country + North-America region). Does NOT compute slug/fingerprint — those are
 * derived at upsert time, because bulkWrite/updateOne skip the pre-save hooks.
 */
export function normalizeRawEvent(raw: any, source: Source): CanonicalEvent {
    const doc = mapRaw(raw, source);
    doc.title = cleanTitle(doc.title);
    const geo = classifyRegion({
        city: doc.city,
        country: doc.country,
        venue: doc.venue,
        online: doc.mode === 'online',
        regions: raw?._regions,
    });
    doc.country = geo.country;
    // Non-NA (incl. online events whose region hints exclude North America) collapse
    // to INTL so the scrape gate drops them — keeps the feed North-America focused.
    doc.region = geo.isNorthAmerica ? geo.region : 'INTL';
    return doc;
}

/** Field mappings verified against live fetches / actor test runs (2026-06-10). */
function mapRaw(raw: any, source: Source): CanonicalEvent {
    switch (source) {
        case 'luma':
            return mapLumaEvent(raw, source);

        case 'eventbrite': {
            // parseforge/eventbrite-scraper item: startDate/startTime are already local
            const title = String(raw.title).slice(0, 100);
            const online = raw.isOnline === true;
            const city = canonicalCity(raw.venue?.city ?? (online ? 'Online' : DEFAULT_CITY));
            const organizer = raw.organizer?.name ?? 'Eventbrite organizer';
            const text = `${title} ${raw.summary ?? ''} ${(raw.tags ?? []).join(' ')}`;
            const description = stripHtml(raw.description ?? '') || raw.summary || '';
            return {
                title,
                description: (description || fallbackDescription(title, city, organizer)).slice(0, 1000),
                image: raw.images?.medium ?? raw.imageUrl ?? '',
                venue: raw.venue?.fullAddress ?? raw.venue?.name ?? (online ? 'Online' : 'TBA'),
                country: countryName(raw.venue?.country),
                city,
                date: raw.startDate,
                time: raw.startTime ?? '09:00',
                endDate: raw.endDate ?? undefined,
                endTime: raw.endTime ?? undefined,
                timezone: raw.timezone ?? DEFAULT_TZ,
                mode: online ? 'online' : 'offline',
                organizer,
                tags: deriveTags(text),
                url: raw.url,
                source,
                sourceId: raw.id,
                isFree: raw.pricing?.isFree ?? undefined,
                price: raw.pricing?.priceDisplay ?? undefined,
                category: mapCategory(`${raw.format ?? ''} ${title}`),
            };
        }

        case 'meetup': {
            // easyapi/meetup-events-scraper item: dateTime is ISO with offset
            const tz = raw.group?.timezone ?? DEFAULT_TZ;
            const online = raw.eventType === 'ONLINE';
            const city = canonicalCity(raw.venue?.city ?? (online ? 'Online' : DEFAULT_CITY));
            const organizer = raw.group?.name ?? 'Meetup group';
            const title = String(raw.title).slice(0, 100);
            return {
                title,
                description: (stripHtml(raw.description ?? '') || fallbackDescription(title, city, organizer)).slice(0, 1000),
                image: raw.featuredEventPhoto?.highResUrl ?? raw.displayPhoto?.highResUrl ?? '',
                venue: raw.venue?.address ?? raw.venue?.name ?? (online ? 'Online' : 'TBA'),
                country: countryName(raw.venue?.country),
                city,
                date: normalizeDate(raw.dateTime, tz),
                time: normalizeTime(raw.dateTime, tz),
                timezone: tz,
                mode: online ? 'online' : 'offline',
                organizer,
                tags: deriveTags(`${title} ${organizer}`),
                url: raw.eventUrl,
                source,
                sourceId: raw.id,
                isFree: raw.feeSettings == null,
                category: mapCategory(title) ?? 'meetup',
            };
        }

        case 'mlh': {
            // Embedded season-page JSON: startsAt/endsAt are UTC ISO
            const digital = raw.formatType === 'digital';
            const title = String(raw.name).slice(0, 100);
            return {
                title,
                description: `${title} — an MLH ${raw.dateRange ?? ''} hackathon (${raw.location ?? 'see site'}). Details and registration on the event website.`.slice(0, 1000),
                image: raw.backgroundUrl ?? raw.logoUrl ?? '',
                venue: raw.location ?? (digital ? 'Online' : 'TBA'),
                country: digital ? 'Online' : countryName(raw.venueAddress?.country),
                city: digital ? 'Online' : canonicalCity(raw.venueAddress?.city ?? DEFAULT_CITY),
                date: normalizeDate(raw.startsAt, DEFAULT_TZ),
                time: normalizeTime(raw.startsAt, DEFAULT_TZ),
                endDate: raw.endsAt ? normalizeDate(raw.endsAt, DEFAULT_TZ) : undefined,
                endTime: raw.endsAt ? normalizeTime(raw.endsAt, DEFAULT_TZ) : undefined,
                timezone: DEFAULT_TZ,
                mode: digital ? 'online' : 'offline',
                organizer: 'Major League Hacking',
                tags: ['tech', 'hackathon', ...(/(^|\s)(ai|data|genai)/i.test(title) ? ['ai'] : [])],
                url: raw.websiteUrl ?? `https://mlh.io${raw.url}`,
                source,
                sourceId: raw.id,
                isFree: true,
                category: 'hackathon',
            };
        }

        case 'company': {
            if (raw._std) return mapStdCompanyEvent(raw);
            if (raw._provider === 'luma') return mapLumaEvent(raw, source, raw._company);

            // WordPress "The Events Calendar" REST item: start_date is already local;
            // titles can carry HTML entities (&#8211;) — stripHtml decodes the common ones
            const title = stripHtml(String(raw.title)).slice(0, 100);
            const online = raw.venue?.venue === 'Virtual' || raw.venue?.slug === 'virtual';
            const city = canonicalCity(raw.venue?.city ?? raw._city ?? DEFAULT_CITY);
            const organizer = raw._company ?? 'Company';
            return {
                title,
                description: (stripHtml(raw.description ?? '') || fallbackDescription(title, city, organizer)).slice(0, 1000),
                image: raw.image?.url ?? '',
                venue: raw.venue?.venue ?? (online ? 'Online' : 'TBA'),
                country: DEFAULT_COUNTRY,
                city,
                date: raw.start_date.slice(0, 10),
                time: raw.start_date.slice(11, 16),
                endDate: raw.end_date ? raw.end_date.slice(0, 10) : undefined,
                endTime: raw.end_date ? raw.end_date.slice(11, 16) : undefined,
                timezone: raw.timezone ?? DEFAULT_TZ,
                mode: online ? 'online' : 'offline',
                organizer,
                tags: deriveTags(`${title} ${organizer}`),
                url: raw.website || raw.url,
                source,
                sourceId: String(raw.id),
                price: raw.cost || undefined,
                category: mapCategory(title),
            };
        }
    }
}

function mapCategory(v?: string): CanonicalEvent['category'] {
    const s = (v ?? '').toLowerCase();
    if (/hack/.test(s)) return 'hackathon';
    if (/conf|summit|expo|devfest/.test(s)) return 'conference';
    if (/network|social|mixer|drinks|happy hour|breakfast/.test(s)) return 'networking';
    if (/meet/.test(s)) return 'meetup';
    return undefined;
}
