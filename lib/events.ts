/**
 * Server-side data layer for pages. Queries Mongoose directly (no HTTP hop to
 * /api/events — that route stays as the external API surface with the same
 * filter semantics). Returns plain serializable objects safe to pass into
 * client components.
 */
import 'server-only';
import type { QueryFilter } from 'mongoose';
import connectDB from '@/database/mongodb';
import { Event, type IEvent } from '@/database';

export interface EventDoc {
    title: string;
    slug: string;
    description: string;
    overview?: string;
    image: string;
    venue: string;
    country: string;
    city: string;
    date: string;      // YYYY-MM-DD
    time: string;      // HH:MM 24h
    endDate?: string;
    endTime?: string;
    timezone: string;
    mode: 'online' | 'offline' | 'hybrid';
    audience?: string;
    agenda?: string[];
    organizer: string;
    tags: string[];
    url: string;
    source: 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company' | 'hackathon';
    isFree?: boolean;
    price?: string;
    category?: 'hackathon' | 'meetup' | 'conference' | 'networking';
    region?: 'CA' | 'US' | 'ONLINE' | 'INTL' | 'UNKNOWN';
}

export interface EventQuery {
    q?: string;
    city?: string;
    mode?: string;
    category?: string;
    source?: string;
    /** Multi-source scope (used by the home page's community sections). */
    sources?: string[];
    /** Exact organizer match, case-insensitive — powers the company chips. */
    organizer?: string;
    /** North-America region scope: 'canada' | 'us' | 'online'. */
    region?: string;
    price?: string;
    from?: string;
    to?: string;
    tag?: string;
    page?: number;
    limit?: number;
    /**
     * Include still-running events (endDate >= from) whose start is already past —
     * relevant for hackathons with long submission windows. Defaults on for the
     * hackathon category so the general feed stays chronological/uncluttered.
     */
    includeOngoing?: boolean;
}

const MODES = ['online', 'offline', 'hybrid'];
const CATEGORIES = ['hackathon', 'meetup', 'conference', 'networking'];
const SOURCES = ['luma', 'eventbrite', 'meetup', 'mlh', 'company', 'hackathon'];
/** Community platforms collapsed into the "Local" lane (source=local). */
const LOCAL_SOURCES = ['luma', 'eventbrite', 'meetup'];

/** Today's date string in the events' home timezone — the feed shows upcoming by default. */
export function todayInToronto(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NON_CITY = ['Online', 'TBA', 'Hybrid Event', ''];

/**
 * Distinct upcoming-event cities, optionally scoped to a region — powers the
 * city dropdown so it reflects real data (US cities when region=us, etc.)
 * instead of a hardcoded Canadian list.
 */
export async function distinctCities(region?: string): Promise<string[]> {
    await connectDB();
    const match: QueryFilter<IEvent> = { date: { $gte: todayInToronto() }, city: { $nin: NON_CITY } };
    if (region === 'canada') match.region = 'CA';
    else if (region === 'us') match.region = 'US';
    const cities = (await Event.distinct('city', match)) as string[];
    return cities.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toDoc(d: any): EventDoc {
    return {
        title: d.title, slug: d.slug, description: d.description, overview: d.overview,
        image: d.image, venue: d.venue, country: d.country, city: d.city,
        date: d.date, time: d.time, endDate: d.endDate, endTime: d.endTime,
        timezone: d.timezone ?? 'America/Toronto', mode: d.mode,
        audience: d.audience, agenda: d.agenda, organizer: d.organizer,
        tags: d.tags ?? [], url: d.url ?? '', source: d.source ?? 'company',
        isFree: d.isFree, price: d.price, category: d.category, region: d.region,
    };
}

export interface EventPage {
    items: EventDoc[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
}

export async function queryEvents(params: EventQuery = {}): Promise<EventPage> {
    await connectDB();

    const filter: QueryFilter<IEvent> = {};

    if (params.mode && MODES.includes(params.mode)) filter.mode = params.mode;
    if (params.city) filter.city = { $regex: `^${escapeRegex(params.city)}$`, $options: 'i' };
    if (params.category && CATEGORIES.includes(params.category)) {
        filter.category = params.category as IEvent['category'];
    }
    if (params.source === 'local') {
        // UX lane: Luma/Eventbrite/Meetup are one "Local events" bucket — the
        // platform doesn't matter to someone browsing for something to attend.
        filter.source = { $in: LOCAL_SOURCES as IEvent['source'][] };
    } else if (params.source && SOURCES.includes(params.source)) {
        filter.source = params.source as IEvent['source'];
    } else if (params.sources?.length) {
        filter.source = { $in: params.sources.filter((s) => SOURCES.includes(s)) as IEvent['source'][] };
    }
    if (params.organizer) {
        filter.organizer = { $regex: `^${escapeRegex(params.organizer)}$`, $options: 'i' };
    }
    if (params.region === 'canada') filter.region = 'CA';
    else if (params.region === 'us') filter.region = 'US';
    else if (params.region === 'online') filter.region = 'ONLINE';
    if (params.tag) filter.tags = params.tag;
    if (params.price === 'free') filter.isFree = true;
    if (params.price === 'paid') filter.isFree = false;

    // Date scope. Default: starts on/after `from` (chronological feed). For
    // hackathons, also include still-running events (endDate >= from) whose start is
    // already past — long submission windows mean "open now" matters more than start.
    // YYYY-MM-DD compares lexically === chronologically.
    const from = params.from ?? todayInToronto();
    const q = params.q?.trim();
    // Ongoing-inclusion uses $or, which MongoDB forbids alongside $text — so when a
    // search is active, fall back to a plain date range (search is relevance-sorted,
    // not date-grouped, so dropping still-running past-start events is acceptable).
    const includeOngoing = !q && (params.includeOngoing ?? params.category === 'hackathon');
    if (includeOngoing) {
        const notEnded = [{ date: { $gte: from } }, { endDate: { $gte: from } }];
        if (params.to) filter.$and = [{ date: { $lte: params.to } }, { $or: notEnded }];
        else filter.$or = notEnded;
    } else {
        filter.date = { $gte: from, ...(params.to ? { $lte: params.to } : {}) };
    }

    if (q) filter.$text = { $search: q };

    const limit = Math.min(Math.max(params.limit ?? 18, 1), 60);
    const page = Math.max(params.page ?? 1, 1);
    const skip = (page - 1) * limit;

    // Search: relevance order via text score. Ongoing feeds: effective-date order so a
    // still-running event (past start) sorts as "today", not at the top with a stale
    // date. Plain feeds: straight date order via find().
    if (q) {
        const [items, total] = await Promise.all([
            Event.find(filter, { score: { $meta: 'textScore' } })
                .sort({ score: { $meta: 'textScore' } }).skip(skip).limit(limit).lean(),
            Event.countDocuments(filter),
        ]);
        return { items: items.map(toDoc), page, limit, total, hasMore: skip + items.length < total };
    }

    if (includeOngoing) {
        const [items, total] = await Promise.all([
            Event.aggregate([
                { $match: filter },
                { $addFields: { _eff: { $cond: [{ $lt: ['$date', from] }, from, '$date'] } } },
                { $sort: { _eff: 1, date: 1, _id: 1 } },
                { $skip: skip },
                { $limit: limit },
            ]),
            Event.countDocuments(filter),
        ]);
        return { items: items.map(toDoc), page, limit, total, hasMore: skip + items.length < total };
    }

    const [items, total] = await Promise.all([
        Event.find(filter).sort({ date: 1, _id: 1 }).skip(skip).limit(limit).lean(),
        Event.countDocuments(filter),
    ]);

    return { items: items.map(toDoc), page, limit, total, hasMore: skip + items.length < total };
}

export async function getEventBySlug(slug: string): Promise<EventDoc | null> {
    await connectDB();
    const doc = await Event.findOne({ slug }).lean();
    return doc ? toDoc(doc) : null;
}

/** Same city or overlapping tags, upcoming, excluding the event itself. */
export async function getRelatedEvents(event: EventDoc, limit = 3): Promise<EventDoc[]> {
    await connectDB();
    const docs = await Event.find({
        slug: { $ne: event.slug },
        date: { $gte: todayInToronto() },
        $or: [{ city: event.city }, { tags: { $in: event.tags.filter((t) => t !== 'tech') } }],
    })
        .sort({ date: 1 })
        .limit(limit)
        .lean();
    return docs.map(toDoc);
}

export interface HomeSections {
    /** Primary: official company events + the chip list of companies with upcoming events. */
    company: EventDoc[];
    companies: { name: string; count: number }[];
    /** Distinct second focus. */
    hackathons: EventDoc[];
    /** Canada-first local layer: Canadian city rails across all sources (+ total per city). */
    canada: { city: string; events: EventDoc[]; total: number }[];
    /** Secondary geographic section: US company events. */
    unitedStates: EventDoc[];
    /** Online events, joinable from anywhere. */
    online: EventDoc[];
}

/** Companies with upcoming events, busiest first — drives the home-page chips + directory counts. */
export async function upcomingCompanies(): Promise<{ name: string; count: number }[]> {
    await connectDB();
    const rows = await Event.aggregate([
        { $match: { source: 'company', date: { $gte: todayInToronto() } } },
        { $group: { _id: '$organizer', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
    ]);
    return rows.map((r: { _id: string; count: number }) => ({ name: r._id, count: r.count }));
}

/**
 * Soonest upcoming event per company — the hero grid showcases the *breadth* of
 * companies, not whichever company happens to have a dense same-day series (e.g.
 * Microsoft's "Build //localhost" runs 19 near-identical city editions). Depth per
 * company is reachable via the organizer chips and "View all".
 */
async function diverseCompanyEvents(limit: number): Promise<EventDoc[]> {
    await connectDB();
    const rows = await Event.aggregate([
        { $match: { source: 'company', date: { $gte: todayInToronto() } } },
        { $sort: { date: 1, _id: 1 } },
        { $group: { _id: '$organizer', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { date: 1, _id: 1 } },
        { $limit: limit },
    ]);
    return rows.map(toDoc);
}

const CANADA_CITIES = ['Toronto', 'Ottawa', 'Montreal'];

export async function getHomeSections(): Promise<HomeSections> {
    const [company, companies, hackathons, unitedStates, online, ...cities] = await Promise.all([
        diverseCompanyEvents(12),
        upcomingCompanies(),
        queryEvents({ category: 'hackathon', limit: 10 }),
        queryEvents({ source: 'company', region: 'us', limit: 9 }),
        queryEvents({ region: 'online', limit: 9 }),
        // Canadian city rails span all sources so local company events appear here too.
        // Pull a fuller set so the carousels don't look sparse (was 3).
        ...CANADA_CITIES.map((city) => queryEvents({ city, limit: 9 })),
    ]);

    return {
        company,
        companies,
        hackathons: hackathons.items,
        unitedStates: unitedStates.items,
        online: online.items,
        canada: CANADA_CITIES.map((city, i) => ({ city, events: cities[i].items, total: cities[i].total }))
            .filter((c) => c.events.length > 0),
    };
}
