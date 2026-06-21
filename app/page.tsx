import Link from 'next/link';
import { Building2, Globe, MapPin, Trophy } from 'lucide-react';
import ExploreBtn from '@/components/ExploreBtn';
import EventGrid from '@/components/EventGrid';
import Carousel from '@/components/Carousel';
import SectionRail from '@/components/SectionRail';
import SectionHeader from '@/components/SectionHeader';
import EmptyState from '@/components/EmptyState';
import FreshnessBadge from '@/components/FreshnessBadge';
import { getHomeSections, queryEvents } from '@/lib/events';
import { getScrapeStatus } from '@/lib/meta';

export const dynamic = 'force-dynamic'; // live DB reads — never prerender at build

/**
 * Home hierarchy (deliberate): official company events are the hero content,
 * hackathons a distinct second focus, then a Canada-first local layer with the
 * United States and online events as secondary sections. North-America scoped.
 */
const Page = async () => {
    const [sections, all, status] = await Promise.all([
        getHomeSections(),
        queryEvents({ limit: 1 }),
        getScrapeStatus(),
    ]);
    const empty =
        !sections.company.length &&
        !sections.hackathons.length &&
        !sections.canada.length &&
        !sections.unitedStates.length &&
        !sections.online.length;

    const topCompanies = sections.companies.slice(0, 10);

    return (
        <section className="flex flex-col gap-24">
            {/* Hero */}
            <div id="home" className="flex flex-col items-center pt-12 text-center max-sm:pt-6">
                <span className="label border-border-dark bg-dark-100/60 rounded-full border px-3 py-1 normal-case">
                    {sections.companies.length}+ companies · Canada-first · North America
                </span>
                <h1 className="text-gradient mt-6 max-w-3xl text-balance">
                    Official dev events, hackathons &amp; meetups — one clean feed
                </h1>
                <p className="subheading">
                    Google, AWS, Microsoft, NVIDIA, YC and 20+ more — official company events and hackathons,
                    Canada-first with the U.S. and online too. No overseas noise to wade through.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <Link
                        href="/events"
                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-7 py-3 text-sm font-semibold transition-colors max-sm:w-full"
                    >
                        Browse all {all.total > 0 ? `${all.total} events` : 'events'}
                    </Link>
                    <ExploreBtn />
                </div>

                {status.lastRunAt && <FreshnessBadge lastRunAt={status.lastRunAt} variant="bare" className="mt-6" />}
            </div>

            <div id="events" className="flex scroll-mt-24 flex-col gap-20">
                {empty && (
                    <EmptyState
                        title="The feed is warming up"
                        hint="The first scrape hasn't landed yet — check back soon or trigger a refresh."
                    />
                )}

                {/* 1 — Primary: official company events */}
                {sections.company.length > 0 && (
                    <section className="flex flex-col gap-6">
                        <SectionHeader
                            title="Company events"
                            subtitle="Official — straight from each company's own events page"
                            icon={Building2}
                            accent="amber"
                            count={sections.companies.length}
                            href="/events?source=company"
                        />

                        {topCompanies.length > 1 && (
                            <div className="flex flex-wrap gap-2">
                                {topCompanies.map(({ name, count }) => (
                                    <Link
                                        key={name}
                                        href={`/events?source=company&organizer=${encodeURIComponent(name)}`}
                                        className="pill hover:border-primary/60 hover:text-primary"
                                    >
                                        {name} <span className="text-light-200">· {count}</span>
                                    </Link>
                                ))}
                                {sections.companies.length > topCompanies.length && (
                                    <Link
                                        href="/events?source=company"
                                        className="pill text-light-200 hover:text-primary hover:border-primary/60"
                                    >
                                        +{sections.companies.length - topCompanies.length} more
                                    </Link>
                                )}
                            </div>
                        )}

                        <Carousel
                            events={sections.company}
                            viewAllHref="/events?source=company"
                            viewAllLabel="All company events"
                        />
                    </section>
                )}

                {/* 2 — Distinct focus: hackathons */}
                {sections.hackathons.length > 0 && (
                    <section className="flex flex-col gap-6">
                        <SectionHeader
                            title="Hackathons"
                            subtitle="MLH, NVIDIA & community hackathons — in person across Canada & the U.S., or online"
                            icon={Trophy}
                            accent="primary"
                            href="/events?category=hackathon"
                        />
                        <Carousel
                            events={sections.hackathons}
                            viewAllHref="/events?category=hackathon"
                            viewAllLabel="All hackathons"
                        />
                    </section>
                )}

                {/* 3 — Canada-first local layer */}
                {sections.canada.length > 0 && (
                    <section className="flex flex-col gap-10">
                        <SectionHeader
                            title="In Canada"
                            subtitle="Company events, meetups & hackathons across the GTA, Ottawa & Quebec"
                            icon={MapPin}
                            accent="primary"
                        />
                        {sections.canada.map(({ city, events, total }) => (
                            <SectionRail
                                key={city}
                                title={city}
                                subtitle={`Upcoming in ${city}`}
                                href={`/events?city=${encodeURIComponent(city)}`}
                                events={events}
                                count={total}
                                viewAllLabel={`All ${total} in ${city}`}
                            />
                        ))}
                    </section>
                )}

                {/* 4 — Secondary: United States */}
                {sections.unitedStates.length > 0 && (
                    <SectionRail
                        title="In the United States"
                        subtitle="Company dev events across the U.S."
                        href="/events?region=us&source=company"
                        events={sections.unitedStates}
                        viewAllLabel="All U.S. events"
                    />
                )}

                {/* 5 — Online, joinable from anywhere */}
                {sections.online.length > 0 && (
                    <section className="flex flex-col gap-6">
                        <SectionHeader
                            title="Online"
                            subtitle="Webinars, workshops & streams you can join from anywhere"
                            icon={Globe}
                            accent="primary"
                            href="/events?region=online"
                        />
                        <EventGrid events={sections.online} />
                    </section>
                )}
            </div>
        </section>
    );
};

export default Page;
