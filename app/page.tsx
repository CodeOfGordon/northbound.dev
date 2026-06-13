import Link from 'next/link';
import { ArrowRight, Globe, MapPin, Trophy } from 'lucide-react';
import ExploreBtn from '@/components/ExploreBtn';
import EventGrid from '@/components/EventGrid';
import SectionRail from '@/components/SectionRail';
import EmptyState from '@/components/EmptyState';
import { getHomeSections, queryEvents } from '@/lib/events';

export const dynamic = 'force-dynamic'; // live DB reads — never prerender at build

/**
 * Home hierarchy (deliberate): official company events are the hero content,
 * hackathons a distinct second focus, then a Canada-first local layer with the
 * United States and online events as secondary sections. North-America scoped —
 * company events outside CA/US are filtered out of the pipeline (see lib/scrape).
 */
const Page = async () => {
    const [sections, all] = await Promise.all([getHomeSections(), queryEvents({ limit: 1 })]);
    const empty =
        !sections.company.length &&
        !sections.hackathons.length &&
        !sections.canada.length &&
        !sections.unitedStates.length &&
        !sections.online.length;

    return (
        <section className="flex flex-col gap-20">
            <div id="home" className="flex flex-col items-center pt-10">
                <h1 className="text-center">
                    Official Dev Events <br /> Across North America
                </h1>
                <p className="subheading">
                    Google, AWS, Microsoft, NVIDIA, YC and 20+ more — official company events and
                    hackathons, Canada-first with the U.S. and online too. No events from overseas to
                    wade through.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                    <ExploreBtn />
                    <Link
                        href="/events"
                        className="bg-primary hover:bg-primary/90 rounded-full px-8 py-3.5 font-semibold text-black transition max-sm:w-full max-sm:text-center"
                    >
                        Browse all {all.total > 0 ? `${all.total} events` : 'events'}
                    </Link>
                </div>
            </div>

            <div id="events" className="flex flex-col gap-16 scroll-mt-24">
                {empty && (
                    <EmptyState
                        title="The feed is warming up"
                        hint="The first scrape hasn't landed yet — check back soon or trigger a refresh."
                    />
                )}

                {/* 1 — Primary: official company events */}
                {sections.company.length > 0 && (
                    <section className="flex flex-col gap-6">
                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <h2 className="font-schibsted-grotesk text-3xl font-bold max-sm:text-2xl">
                                    Company events
                                </h2>
                                <p className="text-light-200 mt-1 text-sm">
                                    Official, from each company&apos;s own events page — conferences, workshops,
                                    webinars and launch events
                                </p>
                            </div>
                            <Link
                                href="/events?source=company"
                                className="text-primary flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline"
                            >
                                View all <ArrowRight className="size-4" aria-hidden />
                            </Link>
                        </div>

                        {sections.companies.length > 1 && (
                            <div className="flex flex-wrap gap-2">
                                {sections.companies.map(({ name, count }) => (
                                    <Link
                                        key={name}
                                        href={`/events?organizer=${encodeURIComponent(name)}`}
                                        className="pill hover:border-primary/60 hover:text-primary transition"
                                    >
                                        {name} <span className="text-light-200">· {count}</span>
                                    </Link>
                                ))}
                            </div>
                        )}

                        <EventGrid events={sections.company} />
                    </section>
                )}

                {/* 2 — Distinct focus: hackathons */}
                {sections.hackathons.length > 0 && (
                    <section className="border-primary/20 bg-primary/[0.04] flex flex-col gap-5 rounded-2xl border p-6 max-sm:p-4">
                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <h2 className="font-schibsted-grotesk flex items-center gap-2.5 text-3xl font-bold max-sm:text-2xl">
                                    <Trophy className="text-primary size-7" aria-hidden /> Hackathons
                                </h2>
                                <p className="text-light-200 mt-1 text-sm">
                                    MLH, NVIDIA and community hackathons — in person across Canada &amp; the U.S., or join online
                                </p>
                            </div>
                            <Link
                                href="/events?category=hackathon"
                                className="text-primary flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline"
                            >
                                View all <ArrowRight className="size-4" aria-hidden />
                            </Link>
                        </div>
                        <EventGrid events={sections.hackathons} />
                    </section>
                )}

                {/* 3 — Canada-first local layer */}
                {sections.canada.length > 0 && (
                    <section className="flex flex-col gap-10">
                        <div>
                            <h2 className="font-schibsted-grotesk flex items-center gap-2.5 text-2xl font-bold">
                                <MapPin className="text-primary size-6" aria-hidden /> In Canada
                            </h2>
                            <p className="text-light-200 mt-1 text-sm">
                                Company events, meetups and hackathons across the GTA, Ottawa &amp; Quebec
                            </p>
                        </div>

                        {sections.canada.map(({ city, events }) => (
                            <SectionRail
                                key={city}
                                title={city}
                                subtitle={`Upcoming in ${city}`}
                                href={`/events?city=${encodeURIComponent(city)}`}
                                events={events}
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
                    />
                )}

                {/* 5 — Online, joinable from anywhere */}
                {sections.online.length > 0 && (
                    <section className="border-dark-200 flex flex-col gap-5 border-t pt-12">
                        <div className="flex items-end justify-between gap-4">
                            <div>
                                <h2 className="font-schibsted-grotesk flex items-center gap-2.5 text-2xl font-bold">
                                    <Globe className="text-primary size-6" aria-hidden /> Online
                                </h2>
                                <p className="text-light-200 mt-1 text-sm">
                                    Webinars, workshops and streams you can join from anywhere
                                </p>
                            </div>
                            <Link
                                href="/events?region=online"
                                className="text-primary flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline"
                            >
                                View all <ArrowRight className="size-4" aria-hidden />
                            </Link>
                        </div>
                        <EventGrid events={sections.online} />
                    </section>
                )}
            </div>
        </section>
    );
};

export default Page;
