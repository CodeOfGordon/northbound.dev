'use client';

import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    src?: string;
    alt: string;
    className?: string;
    /** true (default): object-cover fill a sized box (cards/rows). false: intrinsic height (detail). */
    fill?: boolean;
    /** Target render width — scraped images are resized to this so they're cheap to paint. */
    w?: number;
}

/**
 * Free, on-the-fly resize of arbitrary scraped image URLs via images.weserv.nl
 * (next/image can't enumerate unknown CDNs). Capping width + WebP cuts decode/paint
 * cost ~10x. Falls back to the original URL if the proxy can't fetch it.
 */
function resized(src: string, w: number): string {
    if (!/^https?:\/\//i.test(src)) return src;
    return `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=${w}&output=webp&q=72&we`;
}

/**
 * The fade-in is done by mutating the element's opacity in onLoad (pure DOM, no React
 * state) — so a screenful of images loading during a fast scroll doesn't trigger a
 * cascade of re-renders that would stutter the smooth scroll. State changes only on
 * error (rare). Images fade in over a static placeholder.
 */
const EventImage = ({ src, alt, className, fill = true, w = 640 }: Props) => {
    const [stage, setStage] = useState<'proxy' | 'original' | 'failed'>('proxy');

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
                if (node?.complete) node.style.opacity = '1'; // cached → show immediately
            }}
            src={currentSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            style={{ opacity: 0 }}
            onLoad={(e) => {
                e.currentTarget.style.opacity = '1';
            }}
            onError={() => setStage((s) => (s === 'proxy' ? 'original' : 'failed'))}
            className={cn(
                'object-cover transition-opacity duration-500 ease-out motion-reduce:transition-none',
                fill ? 'absolute inset-0 h-full w-full' : className,
            )}
        />
    );

    if (!fill) return img;

    return <div className={cn('bg-dark-200 relative overflow-hidden', className)}>{img}</div>;
};

export default EventImage;
