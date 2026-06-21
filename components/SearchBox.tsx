'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { Search } from 'lucide-react';

const SearchBox = () => {
    const router = useRouter();
    const pathname = usePathname();
    const sp = useSearchParams();
    const [value, setValue] = useState(sp.get('q') ?? '');

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const next = new URLSearchParams(sp.toString());
        const q = value.trim();
        if (q) next.set('q', q);
        else next.delete('q');
        next.delete('page');
        if (q) posthog.capture('search_performed', { q });
        router.push(`${pathname}?${next.toString()}`);
    };

    return (
        <form onSubmit={submit} className="relative w-full sm:max-w-sm" role="search">
            <Search className="text-light-200 absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <input
                type="search"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Search events, topics, organizers…"
                className="bg-dark-100 border-border-dark placeholder:text-light-200/60 focus:border-primary/60 focus:ring-primary/20 w-full rounded-lg border py-2.5 pl-9 pr-4 text-sm transition-colors focus:outline-none focus:ring-2"
                aria-label="Search events"
            />
        </form>
    );
};

export default SearchBox;
