import type { Metadata } from 'next';
import Link from 'next/link';
import EventRow from '@/components/EventRow';
import EventTimeline from '@/components/EventTimeline';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import SearchBox from '@/components/SearchBox';
import Pagination from '@/components/Pagination';
import CompanyDirectory from '@/components/CompanyDirectory';
import HackathonPlanner from '@/components/HackathonPlanner';
import ApplicantToggle from '@/components/ApplicantToggle';
import { type FeedLane, laneFromParams } from '@/lib/constants';
import { distinctCities, hackathonPlanner, queryEvents, todayInToronto, upcomingCompanies } from '@/lib/events';
import { getApplicant } from '@/lib/applicant';
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
    hackathon: { title: 'Hackathons', subtitle: 'Grouped by when you have to apply — using the deadline that applies to you' },
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

    // Hackathon lane default = the application planner (ADR-029): every
    // upcoming hackathon grouped by when THIS viewer has to apply, not by when
    // it runs — a November event closing applications today belongs at the
    // top, not in the November bucket. It replaces the old 6-month
    // event-date horizon. Explicit from/to (preset chips) or a search fall
    // back to the date timeline. Already-started online challenges stay out of
    // the planner (they'd crowd it); the "Upcoming" preset still shows them.
    const plannerView = lane === 'hackathon' && !first(sp.from) && !first(sp.to) && !q;
    const monthGrouped = lane === 'hackathon' && !q;
    const applicant = await getApplicant();
    const shared = {
        city: first(sp.city),
        mode: first(sp.mode),
        region,
        price: first(sp.price),
        applications: first(sp.applications),
        travel: first(sp.travel),
        tag: first(sp.tag),
        applicant,
    };

    const [result, planner, cities, companyRows] = await Promise.all([
        plannerView
            ? null
            : queryEvents({
                  ...shared,
                  q,
                  category,
                  source,
                  organizer,
                  from: first(sp.from),
                  to: first(sp.to),
                  page: Number(first(sp.page)) || 1,
                  // Month-grouped ranges read as a survey, not a feed — pull the full
                  // query cap per page so later months actually appear on page one.
                  limit: monthGrouped ? 60 : undefined,
              }),
        plannerView ? hackathonPlanner(shared) : null,
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
                    {planner ? (
                        <p className="text-light-200 text-sm">
                            <span className="text-light-100 font-medium">{planner.open}</span> you can apply to now ·{' '}
                            {planner.total} upcoming · {meta.subtitle}
                        </p>
                    ) : (
                        <p className="text-light-200 text-sm">
                            <span className="text-light-100 font-medium">{result!.total}</span> upcoming event
                            {result!.total === 1 ? '' : 's'}
                            {organizer ? ` from ${organizer}` : ''}
                            {q ? ` for “${q}”` : ` · ${meta.subtitle}`}
                        </p>
                    )}
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

            {lane === 'hackathon' && <ApplicantToggle applicant={applicant} />}

            {planner ? (
                planner.groups.length ? <HackathonPlanner groups={planner.groups} /> : <EmptyState />
            ) : result && result.items.length ? (
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
