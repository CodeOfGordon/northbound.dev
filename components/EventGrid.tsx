import EventCard from '@/components/EventCard';
import type { EventDoc } from '@/lib/events';

interface Props {
    events: EventDoc[];
}

const EventGrid = ({ events }: Props) => (
    <ul className="grid list-none grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
            <li key={event.slug}>
                <EventCard event={event} />
            </li>
        ))}
    </ul>
);

export default EventGrid;
