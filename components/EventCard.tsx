'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { Building2, Clock, MapPin, Ticket } from 'lucide-react';
import EventImage from '@/components/EventImage';
import { CATEGORY_LABELS, COUNTRY_FLAG, HIDDEN_TAGS, SOURCE_LABELS } from '@/lib/constants';
import { dateBadge, formatDateRange, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    event: EventDoc;
}

/**
 * Feed card. Company-hosted events get an amber accent so big-company events
 * read differently from community meetups at a glance.
 */
const EventCard = ({ event }: Props) => {
    const { title, slug, image, organizer, city, country, date, endDate, time, mode, source, category, isFree } = event;
    const isCompany = source === 'company';
    const flag = COUNTRY_FLAG[country] ?? '';
    const badge = dateBadge(date);
    const visibleTags = event.tags.filter((t) => !HIDDEN_TAGS.includes(t)).slice(0, 2);

    return (
        <Link
            href={`/events/${slug}`}
            onClick={() => posthog.capture('event_card_clicked', { title, slug, organizer, city, date, time, source })}
            className={cn(
                'group bg-dark-100/60 border-dark-200 card-shadow flex h-full flex-col overflow-hidden rounded-xl border transition',
                isCompany ? 'hover:border-amber-400/60' : 'hover:border-primary/50',
            )}
        >
            <div className="relative">
                <EventImage src={image} alt={title} className="h-44 w-full" />

                <div className="glass absolute left-3 top-3 flex flex-col items-center rounded-md px-2.5 py-1.5 leading-tight">
                    <span className="text-[10px] font-bold tracking-widest text-primary">{badge.month}</span>
                    <span className="text-lg font-bold text-white">{badge.day}</span>
                </div>

                <span
                    className={cn(
                        'glass absolute right-3 top-3 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider',
                        isCompany ? 'text-amber-300' : 'text-light-100',
                    )}
                >
                    {isCompany ? 'Company' : SOURCE_LABELS[source]}
                </span>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-4">
                <h4 className="line-clamp-2 text-lg font-semibold leading-snug group-hover:text-primary">
                    {title}
                </h4>

                <div className="text-light-200 flex flex-col gap-1.5 text-sm">
                    <span className="flex items-center gap-2">
                        <Clock className="size-3.5 shrink-0" aria-hidden />
                        {formatDateRange(date, endDate)} · {formatTime(time)}
                    </span>
                    <span className="flex items-center gap-2">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        {flag && <span aria-hidden>{flag}</span>}
                        {mode === 'online' ? 'Online' : city}
                    </span>
                    <span className="flex items-center gap-2">
                        <Building2 className="size-3.5 shrink-0" aria-hidden />
                        <span className="line-clamp-1">{organizer}</span>
                    </span>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    {category && (
                        <span className="bg-dark-200 text-light-100 rounded-full px-2.5 py-0.5 text-xs">
                            {CATEGORY_LABELS[category]}
                        </span>
                    )}
                    {visibleTags.map((tag) => (
                        <span key={tag} className="border-dark-200 text-light-200 rounded-full border px-2.5 py-0.5 text-xs">
                            {tag}
                        </span>
                    ))}
                    {isFree && (
                        <span className="text-primary ml-auto flex items-center gap-1 text-xs font-semibold">
                            <Ticket className="size-3.5" aria-hidden /> Free
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
};

export default EventCard;
