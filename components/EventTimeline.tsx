import EventRow from '@/components/EventRow';
import { dayHeader, monthHeader } from '@/lib/format';
import type { EventDoc } from '@/lib/events';

interface Props {
    events: EventDoc[];
    /** YYYY-MM-DD in the feed timezone — drives the Today/Tomorrow labels. */
    today: string;
    tomorrow: string;
    /**
     * 'day' (default) — lu.ma-style day buckets. 'month' — month buckets for
     * horizon views (the hackathon lane spans six months; 180 one-row day
     * groups would read as noise).
     */
    granularity?: 'day' | 'month';
}

interface Group {
    key: string;
    label: string;
    sub: string;
    events: EventDoc[];
}

/**
 * Group consecutive events into buckets, preserving incoming (effective-date
 * sorted) order. A still-running event whose start is in the past is clamped to
 * `today` so it lands in the current bucket (it's open now), not a stale one.
 */
function group(events: EventDoc[], today: string, tomorrow: string, granularity: 'day' | 'month'): Group[] {
    const groups: Group[] = [];
    for (const ev of events) {
        const date = ev.date < today ? today : ev.date;
        const key = granularity === 'month' ? date.slice(0, 7) : date;
        const last = groups[groups.length - 1];
        if (last && last.key === key) {
            last.events.push(ev);
            continue;
        }
        const { label, sub } = granularity === 'month' ? monthHeader(key) : dayHeader(date, today, tomorrow);
        groups.push({ key, label, sub, events: [ev] });
    }
    return groups;
}

/**
 * lu.ma-style date-grouped feed: a sticky date rail on the left, dense event
 * rows on the right. Replaces the wall-of-mismatched-images grid on /events.
 */
const EventTimeline = ({ events, today, tomorrow, granularity = 'day' }: Props) => {
    const groups = group(events, today, tomorrow, granularity);

    return (
        <div className="flex flex-col gap-9">
            {groups.map(({ key, label, sub, events: groupEvents }) => (
                <div key={key} className="flex flex-col gap-3 sm:flex-row sm:gap-6">
                    <div className="sm:w-28 sm:shrink-0">
                        <div className="flex items-baseline gap-2 sm:sticky sm:top-24 sm:flex-col sm:items-start sm:gap-0.5">
                            <p className="font-schibsted-grotesk text-lg font-semibold leading-none">{label}</p>
                            <p className="label">{sub}</p>
                        </div>
                    </div>
                    <ul className="flex flex-1 list-none flex-col gap-2.5">
                        {groupEvents.map((event) => (
                            <li key={event.slug}>
                                <EventRow event={event} />
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
};

export default EventTimeline;
