import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
    lastRunAt: Date | string | null;
    /** 'pill' = bordered chip (footer), 'bare' = inline text + dot (hero). */
    variant?: 'pill' | 'bare';
    className?: string;
}

/**
 * "Updated X ago" with a small live dot. Stale (>2 days) dims the dot to amber so
 * the freshness reads honestly rather than always looking green. Pure/presentational
 * — callers fetch the scrape status and pass the timestamp in.
 */
const FreshnessBadge = ({ lastRunAt, variant = 'pill', className }: Props) => {
    if (!lastRunAt) return null;
    const ts = new Date(lastRunAt);
    const stale = Date.now() - ts.getTime() > 2 * 86_400_000;
    const dot = stale ? 'bg-amber' : 'bg-primary';

    const inner = (
        <>
            <span className="relative flex size-1.5">
                {!stale && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', dot)} />}
                <span className={cn('relative inline-flex size-1.5 rounded-full', dot)} />
            </span>
            <span>Updated {timeAgo(ts)}</span>
        </>
    );

    if (variant === 'bare') {
        return (
            <span
                className={cn('text-light-200 inline-flex items-center gap-2 text-sm', className)}
                title={ts.toLocaleString()}
            >
                {inner}
            </span>
        );
    }

    return (
        <span
            className={cn('label border-border-dark bg-dark-100/60 inline-flex items-center gap-2 rounded-full border px-3 py-1 normal-case', className)}
            title={ts.toLocaleString()}
        >
            {inner}
        </span>
    );
};

export default FreshnessBadge;
