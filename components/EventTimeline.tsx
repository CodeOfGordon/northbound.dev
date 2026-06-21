import EventRow from '@/components/EventRow';
import { dayHeader } from '@/lib/format';
import type { EventDoc } from '@/lib/events';

interface Props {
    events: EventDoc[];
    /** YYYY-MM-DD in the feed timezone — drives the Today/Tomorrow labels. */
    today: string;
    tomorrow: string;
}

/**
 * Group consecutive events into day buckets, preserving incoming (effective-date
 * sorted) order. A still-running event whose start is in the past is clamped to
 * `today` so it lands in the "Today" bucket (it's open now), not a stale day.
 */
function groupByDay(events: EventDoc[], today: string): { date: string; events: EventDoc[] }[] {
    const groups: { date: string; events: EventDoc[] }[] = [];
    for (const ev of events) {
        const date = ev.date < today ? today : ev.date;
        const last = groups[groups.length - 1];
        if (last && last.date === date) last.events.push(ev);
        else groups.push({ date, events: [ev] });
    }
    return groups;
}

/**
 * lu.ma-style date-grouped feed: a sticky date rail on the left, dense event
 * rows on the right. Replaces the wall-of-mismatched-images grid on /events.
 */
const EventTimeline = ({ events, today, tomorrow }: Props) => {
    const groups = groupByDay(events, today);

    return (
        <div className="flex flex-col gap-9">
            {groups.map(({ date, events: dayEvents }) => {
                const { label, sub } = dayHeader(date, today, tomorrow);
                return (
                    <div key={date} className="reveal flex flex-col gap-3 sm:flex-row sm:gap-6">
                        <div className="sm:w-28 sm:shrink-0">
                            <div className="flex items-baseline gap-2 sm:sticky sm:top-24 sm:flex-col sm:items-start sm:gap-0.5">
                                <p className="font-schibsted-grotesk text-lg font-semibold leading-none">{label}</p>
                                <p className="label">{sub}</p>
                            </div>
                        </div>
                        <ul className="flex flex-1 list-none flex-col gap-2.5">
                            {dayEvents.map((event) => (
                                <li key={event.slug} className="cv-row">
                                    <EventRow event={event} />
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
};

export default EventTimeline;
