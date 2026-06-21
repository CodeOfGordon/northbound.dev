'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { Building2, MapPin } from 'lucide-react';
import EventImage from '@/components/EventImage';
import { COUNTRY_FLAG, HIDDEN_TAGS, LANE_LABELS, laneOf } from '@/lib/constants';
import { dateBadge, formatDateRange, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
}

/** Per-lane accent — kept subtle: a small dot + the hover border tint. */
const LANE_ACCENT: Record<string, { dot: string; hover: string; text: string }> = {
    company: { dot: 'bg-amber', hover: 'hover:border-amber/40', text: 'text-amber' },
    hackathon: { dot: 'bg-primary', hover: 'hover:border-primary/50', text: 'text-primary' },
    local: { dot: 'bg-light-200', hover: 'hover:border-light-200/40', text: 'text-light-200' },
};

/**
 * Image-forward feed card (home grids). A consistent dark scrim over the
 * scraped image keeps a wall of mismatched sources reading uniformly; the lane
 * accent is a small dot rather than a heavy colored border.
 */
const EventCard = ({ event }: Props) => {
    const { title, slug, image, organizer, city, country, date, endDate, time, mode, source, category, isFree } = event;
    const lane = laneOf(source, category);
    const accent = LANE_ACCENT[lane] ?? LANE_ACCENT.local;
    const flag = COUNTRY_FLAG[country] ?? '';
    const badge = dateBadge(date);
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
                <EventImage src={image} alt={title} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
                <div className="absolute inset-0 bg-gradient-to-t from-dark-100 via-dark-100/10 to-transparent" />

                <div className="bg-dark-100/85 border-border-dark absolute left-3 top-3 flex flex-col items-center rounded-lg border px-2.5 py-1 leading-none">
                    <span className="label text-primary text-[9px]">{badge.month}</span>
                    <span className="font-martian-mono text-base font-semibold text-white">{badge.day}</span>
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
                        {formatDateRange(date, endDate)} · {formatTime(time)}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        {flag && <span aria-hidden>{flag}</span>}
                        <span className="truncate">{mode === 'online' ? 'Online' : city}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <Building2 className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{organizer}</span>
                    </span>
                </div>

                {(visibleTags.length > 0 || isFree) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {visibleTags.map((tag) => (
                            <span key={tag} className="chip text-light-200 text-[11px]">{tag}</span>
                        ))}
                        {isFree && <span className="text-primary ml-auto text-xs font-semibold">Free</span>}
                    </div>
                )}
            </div>
        </Link>
    );
};

export default EventCard;
