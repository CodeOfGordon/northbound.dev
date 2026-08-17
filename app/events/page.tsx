import type { Metadata } from 'next';
import Link from 'next/link';
import EventRow from '@/components/EventRow';
import EventTimeline from '@/components/EventTimeline';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import SearchBox from '@/components/SearchBox';
import Pagination from '@/components/Pagination';
import CompanyDirectory from '@/components/CompanyDirectory';
import { type FeedLane, laneFromParams } from '@/lib/constants';
import { addDaysISO } from '@/lib/format';
import { distinctCities, queryEvents, todayInToronto, upcomingCompanies } from '@/lib/events';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'All events — Northbound',
    description:
        'Filter and search official company dev events, hackathons and community tech events across Canada, the U.S. and online.',
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const LANE_TABS: { key: FeedLane; label: string; href: string }[] = [
    { key: 'all', label: 'All', href: '/events' },
    { key: 'company', label: 'Companies', href: '/events?source=company' },
    { key: 'hackathon', label: 'Hackathons', href: '/events?category=hackathon' },
    { key: 'local', label: 'Local', href: '/events?source=local' },
];

const LANE_META: Record<FeedLane, { title: string; subtitle: string }> = {
    all: { title: 'All events', subtitle: 'Everything we track across North America' },
    company: { title: 'Company events', subtitle: 'Official dev events from the companies we track' },
    hackathon: { title: 'Hackathons', subtitle: 'MLH, Devpost & university hackathons over the next 6 months — apply while applications are open' },
    local: { title: 'Local events', subtitle: 'Community meetups & events from Luma, Eventbrite and Meetup' },
};

const EventsPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
    const sp = await searchParams; // Next 16: searchParams is a Promise

    const source = first(sp.source);
    const category = first(sp.category);
    const region = first(sp.region);
    const organizer = first(sp.organizer);
    const q = first(sp.q);
    const lane = laneFromParams(source, category);

    // Hackathon lane defaults to a 6-month horizon grouped by month — you need
    // to hear about a hackathon while applications are open, not the week it
    // starts. Explicit from/to (preset chips) or a search override the default.
    // The default is a FORWARD calendar: already-started online challenges are
    // excluded (includeOngoing off) — dozens of them would clamp into the
    // current month and bury the planning view. The "Upcoming" preset chip
    // still surfaces them (category default keeps includeOngoing on there).
    const horizonDefault = lane === 'hackathon' && !first(sp.from) && !first(sp.to) && !q;
    const monthGrouped = lane === 'hackathon' && !q;

    const [result, cities, companyRows] = await Promise.all([
        queryEvents({
            q,
            city: first(sp.city),
            mode: first(sp.mode),
            category,
            source,
            organizer,
            region,
            price: first(sp.price),
            from: first(sp.from),
            to: horizonDefault ? addDaysISO(todayInToronto(), 183) : first(sp.to),
            tag: first(sp.tag),
            page: Number(first(sp.page)) || 1,
            // Month-grouped horizon reads as a survey, not a feed — pull the full
            // query cap per page so later months actually appear on page one.
            limit: monthGrouped ? 60 : undefined,
            includeOngoing: horizonDefault ? false : undefined,
        }),
        distinctCities(region),
        upcomingCompanies(),
    ]);

    const companies = companyRows.map((c) => c.name);
    const counts = Object.fromEntries(companyRows.map((c) => [c.name, c.count]));

    // Plain string map for Pagination links (preserves active filters)
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) {
        const val = first(v);
        if (val) flat[k] = val;
    }

    const meta = LANE_META[lane];
    const today = todayInToronto();
    const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);

    return (
        <section className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-1.5">
                    <h1 className="text-4xl max-sm:text-3xl">{meta.title}</h1>
                    <p className="text-light-200 text-sm">
                        <span className="text-light-100 font-medium">{result.total}</span> upcoming event
                        {result.total === 1 ? '' : 's'}
                        {organizer ? ` from ${organizer}` : ''}
                        {q ? ` for “${q}”` : ` · ${meta.subtitle}`}
                    </p>
                </div>
                <SearchBox />
            </div>

            {/* Lane segmented control + compact filters on one calm row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <nav className="border-border-dark bg-dark-100/60 inline-flex w-fit items-center gap-1 rounded-lg border p-1">
                    {LANE_TABS.map(({ key, label, href }) => (
                        <Link key={key} href={href} className={cn('seg', lane === key && 'seg-active')}>
                            {label}
                        </Link>
                    ))}
                </nav>

                <FilterBar cities={cities} companies={companies} />
            </div>

            {lane === 'company' && <CompanyDirectory counts={counts} active={organizer} />}

            {result.items.length ? (
                <>
                    {q ? (
                        // Search results aren't date-ordered — a flat row list reads better than date rails.
                        <ul className="flex list-none flex-col gap-2.5">
                            {result.items.map((event) => (
                                <li key={event.slug}>
                                    <EventRow event={event} />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <EventTimeline
                            events={result.items}
                            today={today}
                            tomorrow={tomorrow}
                            granularity={monthGrouped ? 'month' : 'day'}
                        />
                    )}
                    <Pagination page={result.page} total={result.total} limit={result.limit} searchParams={flat} />
                </>
            ) : (
                <EmptyState />
            )}
        </section>
    );
};

export default EventsPage;
