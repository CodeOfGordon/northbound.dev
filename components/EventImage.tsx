'use client';

import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    src?: string;
    alt: string;
    className?: string;
    /** true (default): object-cover fill a sized box (cards/rows). false: intrinsic height (detail page). */
    fill?: boolean;
}

/**
 * Scraped images come from arbitrary hosts, so this renders a plain <img>
 * (next/image remotePatterns can't enumerate unknown CDNs). It fades each image in
 * over a placeholder once it decodes — so the grid resolves smoothly instead of
 * popping in bit by bit — and swaps in a styled fallback when the URL is missing or
 * fails. The ref-callback marks already-cached images loaded so they never stick at
 * opacity-0.
 */
const EventImage = ({ src, alt, className, fill = true }: Props) => {
    const [failed, setFailed] = useState(false);
    const [loaded, setLoaded] = useState(false);

    if (!src || failed) {
        return (
            <div className={cn('flex-center from-dark-200 via-dark-100 to-black bg-gradient-to-br', className)}>
                <CalendarRange className="text-primary/40 size-10" aria-hidden />
            </div>
        );
    }

    const img = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            ref={(node) => {
                if (node?.complete) setLoaded(true);
            }}
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
                'object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none',
                loaded ? 'opacity-100' : 'opacity-0',
                fill ? 'absolute inset-0 h-full w-full' : className,
            )}
        />
    );

    // Intrinsic mode (detail): fade in over the page background, keep natural height.
    if (!fill) return img;

    // Fill mode (cards/rows): a sized box showing an animated shimmer until the image
    // decodes, then the image fades in over it.
    return (
        <div className={cn('bg-dark-200 relative overflow-hidden', className)}>
            {!loaded && <span className="skeleton-overlay" aria-hidden />}
            {img}
        </div>
    );
};

export default EventImage;
