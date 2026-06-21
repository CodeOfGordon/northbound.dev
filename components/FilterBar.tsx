'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { CATEGORY_LABELS, DATE_PRESETS, MODE_LABELS, REGION_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** Add N days to a YYYY-MM-DD string via UTC date-part math (timezone-safe). */
function addDays(ymd: string, n: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Resolve a date-preset key to a from/to range, anchored to Toronto-local today. */
function presetRange(preset: string): { from?: string; to?: string } {
    // Anchor on the Toronto calendar date — adding raw ms to Date.now() would roll a
    // day early in the evening (Toronto is UTC-4/5), shifting every preset off-by-one.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'week') return { from: today, to: addDays(today, 7) };
    if (preset === 'month') return { from: today, to: addDays(today, 31) };
    return {};
}

function currentPreset(sp: URLSearchParams): string {
    const from = sp.get('from');
    const to = sp.get('to');
    if (!from || !to) return '';
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    if (days === 0) return 'today';
    if (days <= 7) return 'week';
    return 'month';
}

const PRESET_LABEL: Record<string, string> = { today: 'Today', week: 'This week', month: 'This month' };

type Lane = 'all' | 'company' | 'hackathon' | 'local';

interface Props {
    cities: string[];
    companies: string[];
}

/**
 * Compact filter control. The bar shows only a "Filters" button (with an active
 * count) plus removable chips for whatever's applied — the full set of selects
 * lives in a popover, so the page leads with events, not controls.
 */
const FilterBar = ({ cities, companies }: Props) => {
    const router = useRouter();
    const pathname = usePathname();
    const sp = useSearchParams();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const apply = useCallback(
        (updates: Record<string, string>) => {
            const next = new URLSearchParams(sp.toString());
            for (const [key, value] of Object.entries(updates)) {
                if (value) next.set(key, value);
                else next.delete(key);
            }
            next.delete('page'); // any filter change restarts pagination
            posthog.capture('filter_applied', updates);
            router.push(`${pathname}?${next.toString()}`);
        },
        [router, pathname, sp],
    );

    const lane: Lane =
        sp.get('source') === 'company'
            ? 'company'
            : sp.get('category') === 'hackathon' || sp.get('source') === 'mlh' || sp.get('source') === 'hackathon'
              ? 'hackathon'
              : sp.get('source') === 'local'
                ? 'local'
                : 'all';

    const select = (
        name: string,
        labelText: string,
        options: [string, string][],
        value: string,
        onChange?: (v: string) => void,
    ) => (
        <label className="flex flex-col gap-1.5">
            <span className="label">{labelText}</span>
            <select
                className="field"
                value={value}
                onChange={(e) => (onChange ? onChange(e.target.value) : apply({ [name]: e.target.value }))}
            >
                {options.map(([v, l]) => (
                    <option key={v || 'any'} value={v}>{l}</option>
                ))}
            </select>
        </label>
    );

    const cityOpts = cities.map((c): [string, string] => [c, c]);
    const companyOpts = companies.map((c): [string, string] => [c, c]);

    // Active-filter chips (each removable), derived from the URL.
    const chips: { key: string; label: string; clear: Record<string, string> }[] = [];
    const region = sp.get('region');
    if (region) chips.push({ key: 'region', label: REGION_LABELS[region] ?? region, clear: { region: '', city: '' } });
    const organizer = sp.get('organizer');
    if (organizer) chips.push({ key: 'organizer', label: organizer, clear: { organizer: '' } });
    const city = sp.get('city');
    if (city) chips.push({ key: 'city', label: city, clear: { city: '' } });
    const category = sp.get('category');
    // Show a removable chip for any category except 'hackathon' (which IS the lane, so
    // a chip would be redundant) — this also surfaces an otherwise-hidden category
    // filter when it conflicts with the active lane (e.g. ?category=conference&source=mlh).
    if (category && category !== 'hackathon') chips.push({ key: 'category', label: CATEGORY_LABELS[category] ?? category, clear: { category: '' } });
    const mode = sp.get('mode');
    if (mode) chips.push({ key: 'mode', label: MODE_LABELS[mode] ?? mode, clear: { mode: '' } });
    const price = sp.get('price');
    if (price) chips.push({ key: 'price', label: price === 'free' ? 'Free' : 'Paid', clear: { price: '' } });
    const preset = currentPreset(new URLSearchParams(sp.toString()));
    if (preset) chips.push({ key: 'date', label: PRESET_LABEL[preset], clear: { from: '', to: '' } });

    const count = chips.length;

    const clearAll = () => {
        posthog.capture('filter_applied', { cleared: true });
        const lanePart = sp.get('source')
            ? `?source=${sp.get('source')}`
            : sp.get('category')
              ? `?category=${sp.get('category')}`
              : '';
        router.push(`${pathname}${lanePart}`);
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={ref}>
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className={cn('pill', count > 0 ? 'border-primary/50 text-primary' : 'hover:border-light-200/50')}
                >
                    <SlidersHorizontal className="size-3.5" aria-hidden />
                    Filters
                    {count > 0 && (
                        <span className="bg-primary text-primary-foreground ml-0.5 rounded-full px-1.5 text-[11px] font-bold">
                            {count}
                        </span>
                    )}
                    <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
                </button>

                {open && (
                    <div className="bg-popover border-border-dark card-shadow absolute left-0 top-full z-40 mt-2 w-[min(90vw,28rem)] rounded-xl border p-4 sm:left-auto sm:right-0">
                        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                            {select(
                                'region',
                                'Region',
                                [['', 'All of N. America'], ...Object.entries(REGION_LABELS)],
                                sp.get('region') ?? '',
                                (value) => apply({ region: value, city: '' }),
                            )}

                            {lane === 'company' && companyOpts.length > 0 &&
                                select('organizer', 'Company', [['', 'All companies'], ...companyOpts], sp.get('organizer') ?? '')}

                            {lane !== 'company' && lane !== 'hackathon' && cityOpts.length > 0 &&
                                select('city', 'City', [['', 'All cities'], ...cityOpts], sp.get('city') ?? '')}

                            {(lane === 'all' || lane === 'local') &&
                                select('category', 'Type', [['', 'All types'], ...Object.entries(CATEGORY_LABELS)], sp.get('category') ?? '')}

                            {select('mode', 'Format', [['', 'Any format'], ...Object.entries(MODE_LABELS)], sp.get('mode') ?? '')}

                            {(lane === 'all' || lane === 'local') &&
                                select('price', 'Price', [['', 'Any price'], ['free', 'Free'], ['paid', 'Paid']], sp.get('price') ?? '')}

                            {select(
                                'date',
                                'When',
                                DATE_PRESETS.map((p): [string, string] => [p.value, p.label]),
                                preset,
                                (value) => {
                                    const { from = '', to = '' } = presetRange(value);
                                    apply({ from, to });
                                },
                            )}
                        </div>

                        {count > 0 && (
                            <div className="border-border-dark mt-4 flex justify-end border-t pt-3">
                                <button type="button" onClick={clearAll} className="text-light-200 hover:text-primary text-sm">
                                    Reset filters
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {chips.map((chip) => (
                <button
                    key={chip.key}
                    type="button"
                    onClick={() => apply(chip.clear)}
                    className="chip hover:border-primary/50 hover:text-primary group transition-colors"
                >
                    {chip.label}
                    <X className="size-3 opacity-60 group-hover:opacity-100" aria-hidden />
                </button>
            ))}

            {count > 0 && (
                <button type="button" onClick={clearAll} className="text-light-200 hover:text-primary px-1 text-sm">
                    Clear all
                </button>
            )}
        </div>
    );
};

export default FilterBar;
