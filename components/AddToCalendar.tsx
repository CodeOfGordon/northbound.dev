'use client';

import dynamic from 'next/dynamic';
import posthog from 'posthog-js';
import { defaultEndTime } from '@/lib/format';
import type { EventDoc } from '@/lib/events';

// Web Component — must never render during SSR (see gotchas: hydration mismatch)
const AddToCalendarButton = dynamic(
    () => import('add-to-calendar-button-react').then((m) => m.AddToCalendarButton),
    { ssr: false },
);

interface Props {
    event: EventDoc;
}

const AddToCalendar = ({ event }: Props) => {
    // The lib rejects open-ended timed events: a start time REQUIRES an end time
    const endTime = event.endTime ?? defaultEndTime(event.time);
    const location = event.mode === 'online' ? event.url : `${event.venue}, ${event.city}`;

    return (
        <div
            onClickCapture={() =>
                posthog.capture('calendar_add_clicked', { slug: event.slug, title: event.title, source: event.source })
            }
        >
            <AddToCalendarButton
                name={event.title}
                description={event.description.slice(0, 500)}
                startDate={event.date}
                startTime={event.time}
                endDate={event.endDate ?? event.date}
                endTime={endTime}
                timeZone={event.timezone}
                location={location}
                options={['Google', 'Outlook.com', 'Microsoft365', 'Apple', 'iCal']}
                buttonStyle="round"
                lightMode="dark"
                hideBackground
                size="5"
                label="Add to calendar"
            />
        </div>
    );
};

export default AddToCalendar;
