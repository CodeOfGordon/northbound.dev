'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { Building2, MapPin } from 'lucide-react';
import EventImage from '@/components/EventImage';
import { LANE_ACCENT, LANE_LABELS, laneOf } from '@/lib/constants';
import { eventFlag, formatCityLabel, formatDateRange, formatPrice, formatTime, monthDay, siteLogo } from '@/lib/format';
import { applicationSignal } from '@/lib/hackathon';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
}

/** Dense list row for the timeline feed (lu.ma style): time · thumb · title · meta · lane. */
const EventRow = ({ event }: Props) => {
    const { title, slug, image, organizer, city, date, endDate, time, mode, source, category, isFree, price } = event;
    const lane = laneOf(source, category);
    const accent = LANE_ACCENT[lane];
    const flag = eventFlag(event);
    const priceInfo = formatPrice(isFree, price);
    const place = formatCityLabel(event);
    // Hackathons: the application state is the signal that matters (they're all
    // free) — when known it takes the badge slot instead of "Free".
    const appSignal = applicationSignal(event);
    const showApp = lane === 'hackathon' && appSignal.status !== 'unknown';

    return (
        <Link
            href={`/events/${slug}`}
            onClick={() => posthog.capture('event_card_clicked', { title, slug, organizer, city, date, time, source, view: 'row' })}
            className={cn(
                'group bg-dark-100/50 border-border-dark hover:bg-dark-100 flex items-center gap-4 rounded-xl border p-2.5 pr-4 transition-colors',
                accent.hover,
            )}
        >
            {lane === 'hackathon' ? (
                // Hackathons are date-scoped (stored times are placeholder 9:00s) and the
                // month-grouped horizon rail only gives the month — show the days here.
                <span className="text-light-100 font-martian-mono flex w-16 shrink-0 flex-col text-center text-xs leading-tight max-sm:hidden">
                    <span>{monthDay(date)}</span>
                    {endDate && endDate !== date && <span className="text-light-200">– {monthDay(endDate)}</span>}
                </span>
            ) : (
                <span className="text-light-100 font-martian-mono w-16 shrink-0 text-center text-xs max-sm:hidden">
                    {mode === 'online' ? 'Online' : formatTime(time)}
                </span>
            )}

            <EventImage src={image} alt={title} w={240} fallbackLogo={siteLogo(event.url)} className="h-14 w-20 shrink-0 rounded-lg max-sm:hidden" />

            <div className="min-w-0 flex-1">
                <h3 className="group-hover:text-primary truncate text-[15px] font-semibold leading-tight transition-colors">
                    {title}
                </h3>
                <div className="text-light-200 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                    <span className="font-martian-mono text-light-100 text-xs sm:hidden">
                        {lane === 'hackathon'
                            ? formatDateRange(date, endDate)
                            : `${formatDateRange(date, endDate)} · ${mode === 'online' ? 'Online' : formatTime(time)}`}
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
                    {showApp && appSignal.status === 'open' && appSignal.deadline && (
                        <span className="font-martian-mono text-light-100 text-xs">
                            apply by {monthDay(appSignal.deadline)}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={cn('label flex items-center gap-1.5', accent.text)}>
                    <span className={cn('size-1.5 rounded-full', accent.dot)} />
                    <span className="max-sm:hidden">{LANE_LABELS[lane]}</span>
                </span>
                {showApp ? (
                    appSignal.status === 'open' ? (
                        <span className="text-primary text-xs font-semibold">Apps open</span>
                    ) : (
                        <span className="text-light-200 text-xs">
                            {appSignal.status === 'closed' ? 'Apps closed' : 'Apps soon'}
                        </span>
                    )
                ) : (
                    <>
                        {priceInfo.kind === 'free' && <span className="text-primary text-xs font-semibold">Free</span>}
                        {priceInfo.kind === 'paid' && <span className="text-light-200 text-xs">{priceInfo.label}</span>}
                    </>
                )}
            </div>
        </Link>
    );
};

export default EventRow;
