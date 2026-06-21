'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { Building2, MapPin } from 'lucide-react';
import EventImage from '@/components/EventImage';
import { COUNTRY_FLAG, LANE_LABELS, laneOf } from '@/lib/constants';
import { formatDateRange, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
}

const LANE_ACCENT: Record<string, { dot: string; text: string; hover: string }> = {
    company: { dot: 'bg-amber', text: 'text-amber', hover: 'hover:border-amber/40' },
    hackathon: { dot: 'bg-primary', text: 'text-primary', hover: 'hover:border-primary/50' },
    local: { dot: 'bg-light-200', text: 'text-light-200', hover: 'hover:border-light-200/40' },
};

/** Dense list row for the timeline feed (lu.ma style): time · thumb · title · meta · lane. */
const EventRow = ({ event }: Props) => {
    const { title, slug, image, organizer, city, country, date, endDate, time, mode, source, category, isFree } = event;
    const lane = laneOf(source, category);
    const accent = LANE_ACCENT[lane] ?? LANE_ACCENT.local;
    const flag = COUNTRY_FLAG[country] ?? '';
    const place = mode === 'online' ? 'Online' : city;

    return (
        <Link
            href={`/events/${slug}`}
            onClick={() => posthog.capture('event_card_clicked', { title, slug, organizer, city, date, time, source, view: 'row' })}
            className={cn(
                'group bg-dark-100/50 border-border-dark hover:bg-dark-100 flex items-center gap-4 rounded-xl border p-2.5 pr-4 transition-colors',
                accent.hover,
            )}
        >
            <span className="text-light-100 font-martian-mono w-16 shrink-0 text-center text-xs max-sm:hidden">
                {mode === 'online' ? 'Online' : formatTime(time)}
            </span>

            <EventImage src={image} alt={title} w={240} className="h-14 w-20 shrink-0 rounded-lg max-sm:hidden" />

            <div className="min-w-0 flex-1">
                <h3 className="group-hover:text-primary truncate text-[15px] font-semibold leading-tight transition-colors">
                    {title}
                </h3>
                <div className="text-light-200 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                    <span className="font-martian-mono text-light-100 text-xs sm:hidden">
                        {formatDateRange(date, endDate)} · {mode === 'online' ? 'Online' : formatTime(time)}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Building2 className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{organizer}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        {flag && <span aria-hidden>{flag}</span>}
                        <span className="truncate">{place}</span>
                    </span>
                </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={cn('label flex items-center gap-1.5', accent.text)}>
                    <span className={cn('size-1.5 rounded-full', accent.dot)} />
                    <span className="max-sm:hidden">{LANE_LABELS[lane]}</span>
                </span>
                {isFree && <span className="text-primary text-xs font-semibold">Free</span>}
            </div>
        </Link>
    );
};

export default EventRow;
