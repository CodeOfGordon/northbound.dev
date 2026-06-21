import SectionHeader from '@/components/SectionHeader';
import Carousel from '@/components/Carousel';
import type { EventDoc } from '@/lib/events';

interface Props {
    title: string;
    subtitle?: string;
    href: string; // filtered /events view this section expands into
    events: EventDoc[];
    count?: number;
    /** Label for the trailing "view all" card in the rail. */
    viewAllLabel?: string;
}

/** Home-page section: unified header + a horizontal carousel of cards. */
const SectionRail = ({ title, subtitle, href, events, count, viewAllLabel }: Props) => {
    if (!events.length) return null;
    return (
        <section className="flex flex-col gap-5">
            <SectionHeader title={title} subtitle={subtitle} href={href} count={count} />
            <Carousel events={events} viewAllHref={href} viewAllLabel={viewAllLabel} />
        </section>
    );
};

export default SectionRail;
