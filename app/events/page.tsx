import type { Metadata } from 'next';
import EventGrid from '@/components/EventGrid';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import SearchBox from '@/components/SearchBox';
import Pagination from '@/components/Pagination';
import { queryEvents } from '@/lib/events';

export const metadata: Metadata = {
    title: 'All events — DevEvents',
    description: 'Filter and search tech, AI & data events across the GTA, Ottawa & Quebec.',
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const EventsPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
    const sp = await searchParams; // Next 16: searchParams is a Promise

    const result = await queryEvents({
        q: first(sp.q),
        city: first(sp.city),
        mode: first(sp.mode),
        category: first(sp.category),
        source: first(sp.source),
        price: first(sp.price),
        from: first(sp.from),
        to: first(sp.to),
        tag: first(sp.tag),
        page: Number(first(sp.page)) || 1,
    });

    // Plain string map for Pagination links (preserves active filters)
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) {
        const val = first(v);
        if (val) flat[k] = val;
    }

    return (
        <section className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-4xl max-sm:text-3xl">All events</h1>
                    <p className="text-light-200 mt-2 text-sm">
                        {result.total} upcoming event{result.total === 1 ? '' : 's'}
                        {first(sp.q) ? ` for “${first(sp.q)}”` : ''}
                    </p>
                </div>
                <SearchBox />
            </div>

            <FilterBar />

            {result.items.length ? (
                <>
                    <EventGrid events={result.items} />
                    <Pagination page={result.page} total={result.total} limit={result.limit} searchParams={flat} />
                </>
            ) : (
                <EmptyState />
            )}
        </section>
    );
};

export default EventsPage;
