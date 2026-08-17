'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { Building2, MapPin } from 'lucide-react';
import EventImage from '@/components/EventImage';
import { HIDDEN_TAGS, LANE_ACCENT, LANE_LABELS, laneOf } from '@/lib/constants';
import { dateBadge, eventFlag, formatCityLabel, formatDateRange, formatPrice, formatTime, monthDay, siteLogo } from '@/lib/format';
import { applicationSignal, travelSignal } from '@/lib/hackathon';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
}

/**
 * Image-forward feed card (home grids). A consistent dark scrim over the
 * scraped image keeps a wall of mismatched sources reading uniformly; the lane
 * accent is a small dot rather than a heavy colored border.
 */
const EventCard = ({ event }: Props) => {
    const { title, slug, image, organizer, city, date, endDate, time, source, category, isFree, price } = event;
    const lane = laneOf(source, category);
    const accent = LANE_ACCENT[lane];
    const flag = eventFlag(event);
    const priceInfo = formatPrice(isFree, price);
    const badge = dateBadge(date);
    // Hackathons: application state replaces the (uninformative — all free)
    // "Free" badge; a known travel-aid policy earns a chip.
    const appSignal = applicationSignal(event);
    const showApp = lane === 'hackathon' && appSignal.status !== 'unknown';
    const travel = travelSignal(event);
    const visibleTags = event.tags.filter((t) => !HIDDEN_TAGS.includes(t)).slice(0, 2);

    return (
        <Link
            href={`/events/${slug}`}
            onClick={() => posthog.capture('event_card_clicked', { title, slug, organizer, city, date, time, source })}
            className={cn(
                'group bg-dark-100/70 border-border-dark card-shadow flex h-full flex-col overflow-hidden rounded-xl border transition-colors',
                accent.hover,
            )}
        >
            <div className="relative h-40 overflow-hidden">
                <EventImage src={image} alt={title} fallbackLogo={siteLogo(event.url)} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
                <div className="absolute inset-0 bg-gradient-to-t from-dark-100 via-dark-100/10 to-transparent" />

                <div className="bg-dark-100/85 border-border-dark absolute left-3 top-3 flex flex-col items-center rounded-lg border px-2.5 py-1 leading-none">
                    <span className="label text-primary text-[9px]">{badge.month}</span>
                    <span className="font-martian-mono text-foreground text-base font-semibold">{badge.day}</span>
                </div>

                <span className={cn('label absolute right-3 top-3 flex items-center gap-1.5', accent.text)}>
                    <span className={cn('size-1.5 rounded-full', accent.dot)} />
                    {LANE_LABELS[lane]}
                </span>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-4">
                <h3 className="line-clamp-2 text-base font-semibold leading-snug group-hover:text-primary">{title}</h3>

                <div className="text-light-200 mt-auto flex flex-col gap-1.5 text-sm">
                    <span className="font-martian-mono text-light-100 text-xs">
                        {lane === 'hackathon'
                            ? // Hackathons are date-scoped (times are placeholder 9:00s);
                              // the deadline is the datum that matters.
                              `${formatDateRange(date, endDate)}${appSignal.deadline && appSignal.status === 'open' ? ` · apply by ${monthDay(appSignal.deadline)}` : ''}`
                            : `${formatDateRange(date, endDate)} · ${formatTime(time)}`}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        {flag && <span aria-hidden>{flag}</span>}
                        <span className="truncate">{formatCityLabel(event)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Building2 className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{organizer}</span>
                    </span>
                </div>

                {(visibleTags.length > 0 || priceInfo.kind !== 'unknown' || showApp || travel?.status === 'yes') && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {visibleTags.map((tag) => (
                            <span key={tag} className="chip text-light-200 text-[11px]">{tag}</span>
                        ))}
                        {travel?.status === 'yes' && <span className="chip text-light-100 text-[11px]">Travel aid</span>}
                        {showApp ? (
                            appSignal.status === 'open' ? (
                                <span className="text-primary ml-auto text-xs font-semibold">Apps open</span>
                            ) : (
                                <span className="text-light-200 ml-auto text-xs">
                                    {appSignal.status === 'closed' ? 'Apps closed' : 'Apps soon'}
                                </span>
                            )
                        ) : (
                            <>
                                {priceInfo.kind === 'free' && <span className="text-primary ml-auto text-xs font-semibold">Free</span>}
                                {priceInfo.kind === 'paid' && <span className="text-light-200 ml-auto text-xs">{priceInfo.label}</span>}
                            </>
                        )}
                    </div>
                )}
            </div>
        </Link>
    );
};

export default EventCard;
