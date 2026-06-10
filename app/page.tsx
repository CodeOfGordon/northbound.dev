import Link from 'next/link';
import ExploreBtn from '@/components/ExploreBtn';
import SectionRail from '@/components/SectionRail';
import EmptyState from '@/components/EmptyState';
import { getHomeSections, queryEvents } from '@/lib/events';

export const dynamic = 'force-dynamic'; // live DB reads — never prerender at build

const Page = async () => {
    const [sections, all] = await Promise.all([getHomeSections(), queryEvents({ limit: 1 })]);
    const empty =
        !sections.thisWeek.length && !sections.hackathons.length && !sections.company.length && !sections.cities.length;

    return (
        <section className="flex flex-col gap-20">
            <div id="home" className="flex flex-col items-center pt-10">
                <h1 className="text-center">
                    Every Tech, AI &amp; Data Event <br /> In One Feed
                </h1>
                <p className="subheading">
                    Dev meetups, company events and hackathons across the GTA, Ottawa &amp; Quebec —
                    scraped nightly from Luma, Eventbrite, Meetup, MLH and company sites.
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

                <SectionRail
                    title="Happening this week"
                    subtitle="Don't miss what's around the corner"
                    href="/events"
                    events={sections.thisWeek}
                />
                <SectionRail
                    title="Company & big-tech events"
                    subtitle="Open dev events from AI labs, big tech and research institutes"
                    href="/events?source=company"
                    events={sections.company}
                />
                <SectionRail
                    title="Hackathons"
                    subtitle="MLH and community hackathons in Ontario, Quebec and online"
                    href="/events?category=hackathon"
                    events={sections.hackathons}
                />
                {sections.cities.map(({ city, events }) => (
                    <SectionRail
                        key={city}
                        title={city}
                        subtitle={`Upcoming in ${city}`}
                        href={`/events?city=${encodeURIComponent(city)}`}
                        events={events}
                    />
                ))}
            </div>
        </section>
    );
};

export default Page;
