'use client';

import dynamic from 'next/dynamic';
import posthog from 'posthog-js';
import type { Due } from '@/lib/hackathon';
import { KIND_LABEL } from '@/lib/hackathon';

// Web Component — must never render during SSR (see gotchas: hydration mismatch)
const AddToCalendarButton = dynamic(
    () => import('add-to-calendar-button-react').then((m) => m.AddToCalendarButton),
    { ssr: false },
);

interface Props {
    slug: string;
    title: string;
    url: string;
    due: Due;
}

/** A 30-minute block ending at the deadline — the lib rejects zero-length timed events. */
function startBefore(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const mins = Math.max(0, h * 60 + m - 30);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * "Add the deadline to my calendar" — deadlines are what people miss, so the
 * application cut-off gets its own calendar entry, separate from the event.
 * Timed when the site states a time, otherwise an all-day entry on that date.
 */
const AddDeadlineToCalendar = ({ slug, title, url, due }: Props) => {
    const kind = KIND_LABEL[due.kind];
    const timed = due.time
        ? { startTime: startBefore(due.time), endTime: due.time === '00:00' ? '00:01' : due.time, timeZone: due.tz }
        : {};
    return (
        <div
            onClickCapture={() => posthog.capture('deadline_calendar_add_clicked', { slug, title, kind: due.kind, date: due.date })}
        >
            <AddToCalendarButton
                name={`Apply: ${title} (${kind} deadline)`}
                description={`Hacker applications for ${title} — ${kind} deadline. Apply: ${url}`}
                startDate={due.date}
                endDate={due.date}
                {...timed}
                location={url}
                options={['Google', 'Outlook.com', 'Microsoft365', 'Apple', 'iCal']}
                buttonStyle="round"
                lightMode="dark"
                hideBackground
                size="5"
                label="Add deadline to calendar"
            />
        </div>
    );
};

export default AddDeadlineToCalendar;
