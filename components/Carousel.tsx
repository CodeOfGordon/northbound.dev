'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import EventCard from '@/components/EventCard';
import { cn } from '@/lib/utils';
import type { EventDoc } from '@/lib/events';

interface Props {
    events: EventDoc[];
}

/**
 * Horizontal event rail (lu.ma / Partiful style). Native scroll-snap so it's smooth
 * and touch-friendly with no JS on mobile; desktop gets arrow buttons that fade out
 * at the ends. Fixed-width slides keep card heights even.
 */
const Carousel = ({ events }: Props) => {
    const ref = useRef<HTMLUListElement>(null);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(false);

    const update = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        setAtStart(el.scrollLeft <= 4);
        setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    }, []);

    useEffect(() => {
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [update, events]);

    const nudge = (dir: number) => {
        const el = ref.current;
        if (!el) return;
        el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.85, 640), behavior: 'smooth' });
    };

    const arrow = (side: 'left' | 'right', hidden: boolean) => (
        <button
            type="button"
            aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
            onClick={() => nudge(side === 'left' ? -1 : 1)}
            className={cn(
                'border-border-dark bg-dark-100 text-light-100 hover:border-primary/50 hover:text-primary absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border shadow-md transition sm:flex',
                side === 'left' ? 'left-1' : 'right-1',
                hidden && 'pointer-events-none opacity-0',
            )}
        >
            {side === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
    );

    return (
        <div className="relative">
            <ul
                ref={ref}
                onScroll={update}
                className="no-scrollbar flex snap-x snap-mandatory list-none gap-5 overflow-x-auto scroll-smooth pb-1"
            >
                {events.map((event) => (
                    <li key={event.slug} className="w-[280px] shrink-0 snap-start sm:w-[300px]">
                        <EventCard event={event} />
                    </li>
                ))}
            </ul>
            {arrow('left', atStart)}
            {arrow('right', atEnd)}
        </div>
    );
};

export default Carousel;
