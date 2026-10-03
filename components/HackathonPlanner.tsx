import EventRow from '@/components/EventRow';
import type { PlannerGroup } from '@/lib/events';

interface Props {
    groups: PlannerGroup[];
}

/**
 * The hackathon lane's default view (ADR-029): grouped by when the viewer has
 * to APPLY, not by when the event runs — "Closes this week" first, closed ones
 * folded away at the bottom. Same rail-and-rows layout as EventTimeline.
 */
const HackathonPlanner = ({ groups }: Props) => (
    <div className="flex flex-col gap-9">
        {groups.map(({ key, title, hint, events }) => {
            const rows = (
                <ul className="flex flex-1 list-none flex-col gap-2.5">
                    {events.map((event) => (
                        <li key={event.slug}>
                            <EventRow event={event} showDate />
                        </li>
                    ))}
                </ul>
            );
            const rail = (
                <div className="sm:w-28 sm:shrink-0">
                    <div className="flex items-baseline gap-2 sm:sticky sm:top-24 sm:flex-col sm:items-start sm:gap-0.5">
                        <p className="font-schibsted-grotesk text-lg font-semibold leading-tight">{title}</p>
                        <p className="label">{hint}</p>
                    </div>
                </div>
            );

            if (key === 'closed') {
                // Still upcoming, but nothing to act on — folded so it can't bury what's open.
                return (
                    <details key={key} className="group flex flex-col gap-3">
                        <summary className="text-light-200 hover:text-primary cursor-pointer list-none text-sm font-medium transition-colors">
                            <span className="group-open:hidden">Show</span>
                            <span className="hidden group-open:inline">Hide</span> {events.length} hackathon
                            {events.length === 1 ? '' : 's'} with applications closed
                        </summary>
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:gap-6">
                            {rail}
                            {rows}
                        </div>
                    </details>
                );
            }

            return (
                <section key={key} className="flex flex-col gap-3 sm:flex-row sm:gap-6" aria-label={title}>
                    {rail}
                    {rows}
                </section>
            );
        })}
    </div>
);

export default HackathonPlanner;
