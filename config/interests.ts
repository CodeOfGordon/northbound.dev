/**
 * What the daily digest email watches for — edit freely, it's plain data.
 * Fields within a rule AND together; rules OR (see lib/notify/match.ts for
 * the full field list: category/source/region/city/tags/keywords/exclude/
 * minDaysOut). Hackathon application-open alerts and deadline reminders are
 * separate digest sections and fire regardless of these rules.
 */
import type { InterestRule } from '@/lib/notify/match';

export const interests: InterestRule[] = [
    // New hackathons, but only ones far enough out that applications are
    // plausibly still open — a hackathon starting in two weeks is too late.
    { label: 'Hackathons', category: 'hackathon', minDaysOut: 21 },

    // Official company events (OpenAI, Google, Vercel, …) — any region.
    { label: 'Company events', source: 'company' },
];
