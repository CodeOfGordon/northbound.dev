import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    page: number;
    total: number;
    limit: number;
    searchParams: Record<string, string>;
}

/** Prev/next links that preserve the active filters (server component). */
const Pagination = ({ page, total, limit, searchParams }: Props) => {
    const pages = Math.max(Math.ceil(total / limit), 1);
    if (pages <= 1) return null;

    const href = (p: number) => {
        const sp = new URLSearchParams(searchParams);
        if (p > 1) sp.set('page', String(p));
        else sp.delete('page');
        const qs = sp.toString();
        return qs ? `/events?${qs}` : '/events';
    };

    const linkCls = (disabled: boolean) =>
        cn(
            'border-dark-200 flex items-center gap-1 rounded-lg border px-4 py-2 text-sm',
            disabled ? 'text-light-200/40 pointer-events-none' : 'hover:border-primary/50 hover:text-primary',
        );

    return (
        <nav className="flex-center gap-4 pt-4" aria-label="Pagination">
            <Link href={href(page - 1)} className={linkCls(page <= 1)} aria-disabled={page <= 1}>
                <ChevronLeft className="size-4" aria-hidden /> Prev
            </Link>
            <span className="text-light-200 text-sm">
                Page {page} of {pages}
            </span>
            <Link href={href(page + 1)} className={linkCls(page >= pages)} aria-disabled={page >= pages}>
                Next <ChevronRight className="size-4" aria-hidden />
            </Link>
        </nav>
    );
};

export default Pagination;
