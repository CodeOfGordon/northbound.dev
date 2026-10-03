'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { Building2, MapPin } from 'lucide-react';
import EventImage from '@/components/EventImage';
import { LANE_ACCENT, LANE_LABELS, laneOf } from '@/lib/constants';
import { eventFlag, formatCityLabel, formatDateRange, formatPrice, formatTime, monthDay, siteLogo } from '@/lib/format';
import { KIND_LABEL, applicationBadge, stateOf } from '@/lib/hackathon';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
    /**
     * Month-grouped feeds: the rail only pins the month, so rows carry explicit
     * Event / Apply-by columns. Hackathon rows do this regardless.
     */
    showDate?: boolean;
}

/**
 * Dense list row for the timeline feed (lu.ma style). Two shapes:
 *  - day-grouped:  time · thumb · title+meta · (apply-by col) · lane
 *  - month-grouped/hackathon: thumb · title+meta · EVENT col · APPLY BY col · lane
 * The labeled fixed-width columns exist because "when it runs" and "when to
 * apply by" are both dates — unlabeled they're indistinguishable.
 */
const EventRow = ({ event, showDate = false }: Props) => {
    const { title, slug, image, organizer, city, date, endDate, time, mode, source, category, isFree, price } = event;
    const lane = laneOf(source, category);
    const accent = LANE_ACCENT[lane];
    const flag = eventFlag(event);
    const priceInfo = formatPrice(isFree, price);
    const place = formatCityLabel(event);
    // Hackathons: the application state is the signal that matters (they're all
    // free) — when known it takes the badge slot instead of "Free". Resolved
    // per viewer at read time: `actBy` is THEIR tier (priority when they'd
    // travel in from another country). ADR-029.
    const app = stateOf(event);
    const badge = lane === 'hackathon' ? applicationBadge(app) : null;
    const actBy = app.status !== 'closed' ? app.actBy : undefined;
    const applyBy = actBy?.date;
    const tierNote = actBy
        ? actBy.kind !== 'regular'
            ? KIND_LABEL[actBy.kind]
            : app.upcoming.find((d) => d !== actBy && d.kind === 'priority')
              ? `priority ${monthDay(app.upcoming.find((d) => d !== actBy && d.kind === 'priority')!.date)}`
              : undefined
        : undefined;
    const urgent = app.status === 'closing_soon';
    // Column mode: hackathon rows always (stored times are placeholder 9:00s and
    // the horizon rail only pins the month); other rows join when they carry an
    // application deadline so the info is never hidden.
    const columns = lane === 'hackathon' || showDate;
    const showTime = lane !== 'hackathon' && mode !== 'online';

    return (
        <Link
            href={`/events/${slug}`}
            onClick={() => posthog.capture('event_card_clicked', { title, slug, organizer, city, date, time, source, view: 'row' })}
            className={cn(
                'group bg-dark-100/50 border-border-dark hover:bg-dark-100 flex items-center gap-4 rounded-xl border p-2.5 pr-4 transition-colors',
                accent.hover,
            )}
        >
            {!columns && (
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
                    {/* Mobile: the columns are hidden, so dates collapse into the meta line. */}
                    <span className="font-martian-mono text-light-100 text-xs sm:hidden">
                        {columns
                            ? `${formatDateRange(date, endDate)}${applyBy ? ` · apply by ${monthDay(applyBy)}${actBy && actBy.kind !== 'regular' ? ` (${KIND_LABEL[actBy.kind]})` : ''}` : ''}`
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
                </div>
            </div>

            {columns ? (
                <>
                    <span className="flex w-28 shrink-0 flex-col gap-1 max-sm:hidden">
                        <span className="label text-[9px]">Event</span>
                        <span className="font-martian-mono text-light-100 flex flex-col text-xs leading-snug">
                            <span className="whitespace-nowrap">{formatDateRange(date, endDate)}</span>
                            {showTime && <span className="text-light-200 whitespace-nowrap">{formatTime(time)}</span>}
                        </span>
                    </span>
                    <span className="flex w-24 shrink-0 flex-col gap-1 max-sm:hidden">
                        <span className="label text-[9px]">Apply by</span>
                        <span className="font-martian-mono flex flex-col text-xs leading-snug">
                            <span className={cn(applyBy ? 'text-light-100' : 'text-light-200', urgent && 'text-primary font-semibold')}>
                                {applyBy ? monthDay(applyBy) : '—'}
                            </span>
                            {tierNote && <span className="text-light-200 whitespace-nowrap">{tierNote}</span>}
                        </span>
                    </span>
                </>
            ) : (
                applyBy && (
                    <span className="flex w-24 shrink-0 flex-col gap-1 max-sm:hidden">
                        <span className="label text-[9px]">Apply by</span>
                        <span className={cn('font-martian-mono text-light-100 text-xs', urgent && 'text-primary font-semibold')}>
                            {monthDay(applyBy)}
                        </span>
                        {tierNote && <span className="font-martian-mono text-light-200 text-xs">{tierNote}</span>}
                    </span>
                )
            )}

            <div className="flex w-24 shrink-0 flex-col items-end gap-1.5">
                <span className={cn('label flex items-center gap-1.5', accent.text)}>
                    <span className={cn('size-1.5 rounded-full', accent.dot)} />
                    <span className="max-sm:hidden">{LANE_LABELS[lane]}</span>
                </span>
                {badge ? (
                    <span className="flex flex-col items-end leading-tight">
                        <span
                            className={cn(
                                'text-xs',
                                badge.tone === 'muted' ? 'text-light-200' : 'text-primary font-semibold',
                                badge.tone === 'strong' && 'font-bold',
                            )}
                        >
                            {badge.text}
                        </span>
                        {badge.sub && <span className="text-light-200 text-[11px]">{badge.sub}</span>}
                    </span>
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
