'use client';

import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    src?: string;
    alt: string;
    className?: string;
}

/**
 * Scraped images come from arbitrary hosts, so this renders a plain <img>
 * (next/image remotePatterns can't enumerate unknown CDNs) and swaps in a
 * styled placeholder when the URL is missing or fails to load.
 */
const EventImage = ({ src, alt, className }: Props) => {
    const [failed, setFailed] = useState(false);

    if (!src || failed) {
        return (
            <div className={cn('flex-center bg-gradient-to-br from-dark-200 via-dark-100 to-black', className)}>
                <CalendarRange className="text-primary/40 size-10" aria-hidden />
            </div>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className={cn('object-cover', className)}
        />
    );
};

export default EventImage;
