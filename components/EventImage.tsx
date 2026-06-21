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
    /** Target render width — scraped images are resized to this so they're cheap to paint. */
    w?: number;
}

/**
 * Free, on-the-fly resize of arbitrary scraped image URLs via images.weserv.nl
 * (next/image can't be used — remotePatterns can't enumerate unknown CDNs). Capping
 * width + serving WebP cuts decode/paint cost by ~10x, which is what keeps fast
 * scrolling smooth. Falls back to the original URL if the proxy can't fetch it.
 */
function resized(src: string, w: number): string {
    if (!/^https?:\/\//i.test(src)) return src;
    return `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=${w}&output=webp&q=72&we`;
}

const EventImage = ({ src, alt, className, fill = true, w = 640 }: Props) => {
    const [stage, setStage] = useState<'proxy' | 'original' | 'failed'>('proxy');
    const [loaded, setLoaded] = useState(false);

    if (!src || stage === 'failed') {
        return (
            <div className={cn('flex-center from-dark-200 via-dark-100 to-black bg-gradient-to-br', className)}>
                <CalendarRange className="text-primary/40 size-10" aria-hidden />
            </div>
        );
    }

    const currentSrc = stage === 'proxy' ? resized(src, w) : src;

    const img = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            key={stage}
            ref={(node) => {
                if (node?.complete) setLoaded(true);
            }}
            src={currentSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            // Proxy miss → try the original; original miss → styled fallback.
            onError={() => setStage((s) => (s === 'proxy' ? 'original' : 'failed'))}
            className={cn(
                'object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none',
                loaded ? 'opacity-100' : 'opacity-0',
                fill ? 'absolute inset-0 h-full w-full' : className,
            )}
        />
    );

    if (!fill) return img;

    return (
        <div className={cn('bg-dark-200 relative overflow-hidden', className)}>
            {!loaded && <span className="skeleton-overlay" aria-hidden />}
            {img}
        </div>
    );
};

export default EventImage;
