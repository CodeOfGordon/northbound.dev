import { NextResponse, type NextRequest } from 'next/server';
import type { QueryFilter } from 'mongoose';
import connectDB from '@/database/mongodb';
import { Event, type IEvent } from '@/database';

export const runtime = 'nodejs';        // Mongoose can't run on Edge
export const dynamic = 'force-dynamic'; // feed must never be stale

const MODES = ['online', 'offline', 'hybrid'];
const CATEGORIES = ['hackathon', 'meetup', 'conference', 'networking'];
const SOURCES = ['luma', 'eventbrite', 'meetup', 'mlh', 'company'];

function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request: NextRequest) {
    await connectDB();
    const sp = request.nextUrl.searchParams;

    const filter: QueryFilter<IEvent> = {};

    const mode = sp.get('mode');
    if (mode && MODES.includes(mode)) filter.mode = mode;

    // city — case-insensitive exact match (anchored so the city index can still help)
    const city = sp.get('city');
    if (city) filter.city = { $regex: `^${escapeRegex(city)}$`, $options: 'i' };

    // 'category' and 'type' are synonyms for the event category
    const category = sp.get('category') ?? sp.get('type');
    if (category && CATEGORIES.includes(category)) {
        filter.category = category as IEvent['category'];
    }

    const source = sp.get('source');
    if (source === 'local') {
        filter.source = { $in: ['luma', 'eventbrite', 'meetup'] as IEvent['source'][] };
    } else if (source && SOURCES.includes(source)) {
        filter.source = source as IEvent['source'];
    }

    // organizer — case-insensitive exact match (company chips link here)
    const organizer = sp.get('organizer');
    if (organizer) filter.organizer = { $regex: `^${escapeRegex(organizer)}$`, $options: 'i' };

    // region — North-America scope shortcut (maps to the derived region field)
    const region = sp.get('region');
    if (region === 'canada') filter.region = 'CA';
    else if (region === 'us') filter.region = 'US';
    else if (region === 'online') filter.region = 'ONLINE';

    const tags = sp.getAll('tag').filter(Boolean);
    if (tags.length) filter.tags = { $in: tags };

    // date range — date is fixed-width YYYY-MM-DD, so a lexical $gte/$lte range
    // IS the chronological range
    const from = sp.get('from');
    const to = sp.get('to');
    if (from || to) {
        filter.date = {};
        if (from) (filter.date as Record<string, string>).$gte = from;
        if (to) (filter.date as Record<string, string>).$lte = to;
    }

    const price = sp.get('price');
    if (price === 'free') filter.isFree = true;
    if (price === 'paid') filter.isFree = false;

    const q = sp.get('q')?.trim();
    if (q) filter.$text = { $search: q };

    // pagination — clamp untrusted input
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 20, 1), 100);
    const page = Math.max(Number(sp.get('page')) || 1, 1);
    const skip = (page - 1) * limit;

    const sort: Record<string, 1 | -1 | { $meta: 'textScore' }> = q
        ? { score: { $meta: 'textScore' } } // relevance for keyword search
        : { date: 1, _id: 1 };              // chronological, deterministic

    const [items, total] = await Promise.all([
        Event.find(filter, q ? { score: { $meta: 'textScore' } } : {})
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        Event.countDocuments(filter),
    ]);

    return NextResponse.json({
        items,
        page,
        limit,
        total,
        hasMore: skip + items.length < total,
    });
}
