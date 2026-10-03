/**
 * Server-side data layer for pages. Queries Mongoose directly (no HTTP hop to
 * /api/events — that route stays as the external API surface with the same
 * filter semantics). Returns plain serializable objects safe to pass into
 * client components.
 */
import 'server-only';
import type { QueryFilter } from 'mongoose';
import connectDB from '@/database/mongodb';
import { Event, type EventEnrichment, type IEvent } from '@/database';
import {
    DEFAULT_APPLICANT,
    applicationState,
    isApplicable,
    type Applicant,
    type ApplicationState,
} from '@/lib/hackathon';

export type { EventEnrichment };

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
    agenda?: string[];
    organizer: string;
    tags: string[];
    url: string;
    source: 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company' | 'hackathon' | 'watchlist';
    isFree?: boolean;
    price?: string;
    category?: 'hackathon' | 'meetup' | 'conference' | 'networking';
    region?: 'CA' | 'US' | 'ONLINE' | 'INTL' | 'UNKNOWN';
    applicationStatus?: 'open' | 'closed' | 'not_yet' | 'unknown';
    applicationDeadline?: string;
    enrichment?: EventEnrichment;
    /** ISO — dates the scrape-owned application status (it refreshes nightly). */
    updatedAt?: string;
    /** Application state resolved at read time for the requesting viewer (ADR-029). */
    app?: ApplicationState;
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
    /** 'open' — only events whose applications are open for this viewer right now. */
    applications?: string;
    /** The viewer — application state on every returned doc is resolved for them. */
    applicant?: Applicant;
    /** 'yes' | 'no' — travel-reimbursement signal from the enrichment pass. */
    travel?: string;
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
const SOURCES = ['luma', 'eventbrite', 'meetup', 'mlh', 'company', 'hackathon', 'watchlist'];
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
/** Lean Mongo doc → serializable EventDoc with application state resolved for `who` at `now`. */
export function toEventDoc(d: any, who?: Applicant, now?: Date): EventDoc {
    return toDoc(d, who, now);
}

function toDoc(d: any, who?: Applicant, now?: Date): EventDoc {
    const doc: EventDoc = {
        title: d.title, slug: d.slug, description: d.description, overview: d.overview,
        image: d.image, venue: d.venue, country: d.country, city: d.city,
        date: d.date, time: d.time, endDate: d.endDate, endTime: d.endTime,
        timezone: d.timezone ?? 'America/Toronto', mode: d.mode,
        agenda: d.agenda, organizer: d.organizer,
        tags: d.tags ?? [], url: d.url ?? '', source: d.source ?? 'company',
        isFree: d.isFree, price: d.price, category: d.category, region: d.region,
        applicationStatus: d.applicationStatus, applicationDeadline: d.applicationDeadline,
        enrichment: d.enrichment,
        updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : undefined,
    };
    // Resolved per request (P2): status, the viewer's act-by tier, staleness.
    doc.app = applicationState(doc, who ?? DEFAULT_APPLICANT, now ?? new Date());
    return doc;
}

export interface EventPage {
    items: EventDoc[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
}

interface BuiltQuery {
    filter: QueryFilter<IEvent>;
    from: string;
    q?: string;
    includeOngoing: boolean;
}

/** Mongo filter for the feed's URL filter contract (shared by the feed and the planner). */
function buildQuery(params: EventQuery): BuiltQuery {
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
    if (params.travel === 'yes' || params.travel === 'no') {
        filter['enrichment.travel.status'] = params.travel;
    }

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
    return { filter, from, q, includeOngoing };
}

/** Raw page of docs for a built query, in the feed's sort order. */
async function runQuery(built: BuiltQuery, skip: number, limit: number): Promise<{ items: any[]; total: number }> {
    const { filter, from, q, includeOngoing } = built;
    // Search: relevance order via text score. Ongoing feeds: effective-date order so a
    // still-running event (past start) sorts as "today", not at the top with a stale
    // date. Plain feeds: straight date order via find().
    if (q) {
        const [items, total] = await Promise.all([
            Event.find(filter, { score: { $meta: 'textScore' } })
                .sort({ score: { $meta: 'textScore' } }).skip(skip).limit(limit).lean(),
            Event.countDocuments(filter),
        ]);
        return { items, total };
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
        return { items, total };
    }
    const [items, total] = await Promise.all([
        Event.find(filter).sort({ date: 1, _id: 1 }).skip(skip).limit(limit).lean(),
        Event.countDocuments(filter),
    ]);
    return { items, total };
}

/**
 * Candidate cap for filters resolved in memory. The application-state filter
 * can't be a Mongo predicate (it depends on the viewer and on `now`), and the
 * candidate sets are tens to low hundreds of docs.
 */
const RESOLVE_CAP = 500;

export async function queryEvents(params: EventQuery = {}): Promise<EventPage> {
    await connectDB();

    const built = buildQuery(params);
    const who = params.applicant ?? DEFAULT_APPLICANT;
    const now = new Date();
    const limit = Math.min(Math.max(params.limit ?? 18, 1), 60);
    const page = Math.max(params.page ?? 1, 1);
    const skip = (page - 1) * limit;

    if (params.applications === 'open') {
        // "Open now" is resolved per viewer at read time (ADR-029): the same
        // precedence the badge uses, so the filter and the badge always agree.
        const { items } = await runQuery(built, 0, RESOLVE_CAP);
        const open = items.map((d) => toDoc(d, who, now)).filter((d) => d.app && isApplicable(d.app));
        const pageItems = open.slice(skip, skip + limit);
        return { items: pageItems, page, limit, total: open.length, hasMore: skip + pageItems.length < open.length };
    }

    const { items, total } = await runQuery(built, skip, limit);
    return { items: items.map((d) => toDoc(d, who, now)), page, limit, total, hasMore: skip + items.length < total };
}

/* ---- Hackathon planner (application-first lane, ADR-029) ----------------- */

export type PlannerBucket = 'closing' | 'month' | 'later' | 'undated' | 'not_yet' | 'closed';

export interface PlannerGroup {
    key: PlannerBucket;
    title: string;
    hint: string;
    events: EventDoc[];
}

export const PLANNER_BUCKETS: { key: PlannerBucket; title: string; hint: string }[] = [
    { key: 'closing', title: 'Closes this week', hint: 'Apply now' },
    { key: 'month', title: 'Closes this month', hint: 'Next 31 days' },
    { key: 'later', title: 'Later', hint: 'Further out' },
    { key: 'undated', title: 'No deadline published', hint: 'Check the site' },
    { key: 'not_yet', title: 'Not open yet', hint: 'Watching' },
    { key: 'closed', title: 'Applications closed', hint: 'Still upcoming' },
];

function bucketOf(e: EventDoc): PlannerBucket {
    const s = e.app!;
    if (s.status === 'closed') return 'closed';
    if (s.status === 'not_yet') return 'not_yet';
    if (!s.actBy) return 'undated';
    if (s.status === 'closing_soon') return 'closing';
    return s.actBy.daysLeft <= 31 ? 'month' : 'later';
}

/**
 * The hackathon lane's default view: every upcoming hackathon grouped by when
 * THIS viewer has to apply, not by when the event runs (P1). Events that
 * haven't started yet, up to a year out; deadline buckets sort by the
 * viewer's act-by instant, the rest by start date.
 */
export async function hackathonPlanner(params: EventQuery = {}): Promise<{ groups: PlannerGroup[]; total: number; open: number }> {
    await connectDB();
    const from = todayInToronto();
    const built = buildQuery({
        ...params,
        category: 'hackathon',
        from,
        to: params.to ?? addDays(from, 365),
        includeOngoing: false,
        q: undefined,
    });
    const who = params.applicant ?? DEFAULT_APPLICANT;
    const now = new Date();
    const { items } = await runQuery(built, 0, RESOLVE_CAP);
    let docs = items.map((d) => toDoc(d, who, now));
    if (params.applications === 'open') docs = docs.filter((d) => isApplicable(d.app!));

    const groups = PLANNER_BUCKETS.map((b) => ({ ...b, events: [] as EventDoc[] }));
    for (const d of docs) groups.find((g) => g.key === bucketOf(d))!.events.push(d);
    for (const g of groups) {
        if (g.key === 'closing' || g.key === 'month' || g.key === 'later') {
            g.events.sort((a, b) => a.app!.actBy!.closesAt.localeCompare(b.app!.actBy!.closesAt) || a.date.localeCompare(b.date));
        }
    }
    return {
        groups: groups.filter((g) => g.events.length),
        total: docs.length,
        open: docs.filter((d) => isApplicable(d.app!)).length,
    };
}

/** Hackathons whose act-by deadline for this viewer falls within the next week (home strip). */
export async function closingSoonHackathons(who: Applicant, limit = 5): Promise<EventDoc[]> {
    const { groups } = await hackathonPlanner({ applicant: who });
    return (groups.find((g) => g.key === 'closing')?.events ?? []).slice(0, limit);
}

function addDays(ymd: string, n: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function getEventBySlug(slug: string, who?: Applicant): Promise<EventDoc | null> {
    await connectDB();
    // Slugs are stored lowercase (schema `lowercase: true`) — normalize the lookup
    // so mixed-case URLs resolve here the same way they do on /api/events/[slug].
    const doc = await Event.findOne({ slug: slug.toLowerCase() }).lean();
    return doc ? toDoc(doc, who) : null;
}

/** Same city or overlapping tags, upcoming, excluding the event itself. */
export async function getRelatedEvents(event: EventDoc, limit = 3, who?: Applicant): Promise<EventDoc[]> {
    await connectDB();
    const docs = await Event.find({
        slug: { $ne: event.slug },
        date: { $gte: todayInToronto() },
        $or: [{ city: event.city }, { tags: { $in: event.tags.filter((t) => t !== 'tech') } }],
    })
        .sort({ date: 1 })
        .limit(limit)
        .lean();
    const now = new Date();
    return docs.map((d) => toDoc(d, who, now));
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
async function diverseCompanyEvents(limit: number, who?: Applicant): Promise<EventDoc[]> {
    await connectDB();
    const rows = await Event.aggregate([
        { $match: { source: 'company', date: { $gte: todayInToronto() } } },
        { $sort: { date: 1, _id: 1 } },
        { $group: { _id: '$organizer', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { date: 1, _id: 1 } },
        { $limit: limit },
    ]);
    const now = new Date();
    return rows.map((d) => toDoc(d, who, now));
}

const CANADA_CITIES = ['Toronto', 'Ottawa', 'Montreal'];

export async function getHomeSections(who?: Applicant): Promise<HomeSections> {
    const [company, companies, hackathons, unitedStates, online, ...cities] = await Promise.all([
        diverseCompanyEvents(12, who),
        upcomingCompanies(),
        queryEvents({ category: 'hackathon', limit: 10, applicant: who }),
        queryEvents({ source: 'company', region: 'us', limit: 9, applicant: who }),
        queryEvents({ region: 'online', limit: 9, applicant: who }),
        // Canadian city rails span all sources so local company events appear here too.
        // Pull a fuller set so the carousels don't look sparse (was 3).
        ...CANADA_CITIES.map((city) => queryEvents({ city, limit: 9, applicant: who })),
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
