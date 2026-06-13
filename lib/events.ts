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
    source: 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';
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
}

const MODES = ['online', 'offline', 'hybrid'];
const CATEGORIES = ['hackathon', 'meetup', 'conference', 'networking'];
const SOURCES = ['luma', 'eventbrite', 'meetup', 'mlh', 'company'];

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
    if (params.source && SOURCES.includes(params.source)) {
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

    // Upcoming by default; YYYY-MM-DD compares lexically === chronologically
    const from = params.from ?? todayInToronto();
    filter.date = { $gte: from, ...(params.to ? { $lte: params.to } : {}) };

    const q = params.q?.trim();
    if (q) filter.$text = { $search: q };

    const limit = Math.min(Math.max(params.limit ?? 18, 1), 60);
    const page = Math.max(params.page ?? 1, 1);
    const skip = (page - 1) * limit;

    const sort: Record<string, 1 | -1 | { $meta: 'textScore' }> = q
        ? { score: { $meta: 'textScore' } }
        : { date: 1, _id: 1 };

    const [items, total] = await Promise.all([
        Event.find(filter, q ? { score: { $meta: 'textScore' } } : {})
            .sort(sort).skip(skip).limit(limit).lean(),
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
    /** Canada-first local layer: Canadian city rails across all sources. */
    canada: { city: string; events: EventDoc[] }[];
    /** Secondary geographic section: US company events. */
    unitedStates: EventDoc[];
    /** Online events, joinable from anywhere. */
    online: EventDoc[];
}

/** Companies with upcoming events, busiest first — drives the home-page chips. */
async function upcomingCompanies(): Promise<{ name: string; count: number }[]> {
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
        queryEvents({ category: 'hackathon', limit: 6 }),
        queryEvents({ source: 'company', region: 'us', limit: 6 }),
        queryEvents({ region: 'online', limit: 6 }),
        // Canadian city rails span all sources so local company events appear here too.
        ...CANADA_CITIES.map((city) => queryEvents({ city, limit: 3 })),
    ]);

    return {
        company,
        companies,
        hackathons: hackathons.items,
        unitedStates: unitedStates.items,
        online: online.items,
        canada: CANADA_CITIES.map((city, i) => ({ city, events: cities[i].items })).filter(
            (c) => c.events.length > 0,
        ),
    };
}
