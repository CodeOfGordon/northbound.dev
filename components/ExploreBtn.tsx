'use client';

import posthog from 'posthog-js';
import { ArrowDown } from 'lucide-react';

/** Hero secondary CTA — smooth-scrolls to the feed and logs the intent. */
const ExploreBtn = () => (
    <a
        href="#events"
        onClick={() => posthog.capture('explore_events_clicked')}
        className="border-border-dark bg-dark-100 text-foreground hover:border-light-200/50 hover:bg-dark-200 inline-flex items-center justify-center gap-2 rounded-full border px-7 py-3 text-sm font-semibold transition-colors max-sm:w-full"
    >
        Explore events <ArrowDown className="size-4" aria-hidden />
    </a>
);

export default ExploreBtn;
