'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { COMPANY_DIRECTORY, INDUSTRY_ORDER } from '@/lib/fetchers/config';
import { cn } from '@/lib/utils';

interface Props {
    /** organizer name -> upcoming event count. */
    counts: Record<string, number>;
    /** currently-filtered organizer, if any. */
    active?: string;
}

/**
 * Collapsible directory of tracked companies (grouped by industry), doubling as a
 * company filter. Collapsed by default so the company lane leads with events;
 * companies with no current events stay listed (dimmed) so coverage is clear.
 */
const CompanyDirectory = ({ counts, active }: Props) => {
    const [open, setOpen] = useState(false);
    const live = COMPANY_DIRECTORY.filter((c) => (counts[c.name] ?? 0) > 0).length;

    return (
        <div className="border-border-dark bg-dark-100/40 flex flex-col gap-4 rounded-xl border p-4">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex items-center justify-between gap-3 text-left"
            >
                <p className="text-light-100 text-sm font-medium">
                    {COMPANY_DIRECTORY.length} companies tracked
                    <span className="text-light-200"> · {live} live now</span>
                </p>
                <span className="text-light-200 hover:text-light-100 flex items-center gap-1 text-sm">
                    {open ? 'Hide' : 'Browse all'}
                    <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
                </span>
            </button>

            {active && !open && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="pill border-primary text-primary">{active}</span>
                    <Link href="/events?source=company" className="text-light-200 hover:text-primary text-sm">
                        Clear
                    </Link>
                </div>
            )}

            {open && (
                <div className="border-border-dark flex flex-col gap-4 border-t pt-4">
                    {INDUSTRY_ORDER.map((industry) => {
                        const companies = COMPANY_DIRECTORY.filter((c) => c.industry === industry);
                        if (!companies.length) return null;
                        return (
                            <div key={industry} className="flex flex-col gap-2">
                                <h3 className="label">{industry}</h3>
                                <div className="flex flex-wrap gap-2">
                                    {companies.map(({ name }) => {
                                        const count = counts[name] ?? 0;
                                        const isActive = active === name;
                                        return (
                                            <Link
                                                key={name}
                                                href={`/events?source=company&organizer=${encodeURIComponent(name)}`}
                                                className={cn(
                                                    'pill text-sm',
                                                    isActive
                                                        ? 'border-primary text-primary'
                                                        : count
                                                          ? 'hover:border-primary/60 hover:text-primary'
                                                          : 'opacity-40',
                                                )}
                                            >
                                                {name}
                                                {count > 0 && <span className="text-light-200"> · {count}</span>}
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default CompanyDirectory;
