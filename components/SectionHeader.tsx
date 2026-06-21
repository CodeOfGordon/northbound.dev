import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    title: string;
    subtitle?: string;
    count?: number;
    href?: string;
    linkLabel?: string;
    icon?: LucideIcon;
    accent?: 'primary' | 'amber' | 'default';
}

const ACCENT_TEXT = {
    primary: 'text-primary',
    amber: 'text-amber',
    default: 'text-light-200',
} as const;

/** Unified section header for the home page — title + count, optional icon, "View all". */
const SectionHeader = ({ title, subtitle, count, href, linkLabel = 'View all', icon: Icon, accent = 'default' }: Props) => (
    <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
            <h2 className="flex items-center gap-2.5">
                {Icon && <Icon className={cn('size-5', ACCENT_TEXT[accent])} aria-hidden />}
                {title}
                {typeof count === 'number' && count > 0 && (
                    <span className="label border-border-dark bg-dark-100 rounded-full border px-2 py-0.5">{count}</span>
                )}
            </h2>
            {subtitle && <p className="text-light-200 text-sm">{subtitle}</p>}
        </div>
        {href && (
            <Link
                href={href}
                className="text-light-200 hover:text-primary flex shrink-0 items-center gap-1 text-sm font-medium transition-colors"
            >
                {linkLabel} <ArrowRight className="size-4" aria-hidden />
            </Link>
        )}
    </div>
);

export default SectionHeader;
