import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import EventGrid from '@/components/EventGrid';
import type { EventDoc } from '@/lib/events';

interface Props {
    title: string;
    subtitle?: string;
    href: string; // filtered /events view this section expands into
    events: EventDoc[];
}

/** Home-page section: heading + "View all" link into the filtered feed. */
const SectionRail = ({ title, subtitle, href, events }: Props) => {
    if (!events.length) return null;
    return (
        <section className="flex flex-col gap-5">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <h3>{title}</h3>
                    {subtitle && <p className="text-light-200 mt-1 text-sm">{subtitle}</p>}
                </div>
                <Link href={href} className="text-primary flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline">
                    View all <ArrowRight className="size-4" aria-hidden />
                </Link>
            </div>
            <EventGrid events={events} />
        </section>
    );
};

export default SectionRail;
