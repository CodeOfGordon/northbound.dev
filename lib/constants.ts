/** UI constants for filters, labels and chips (live data replaced the old sample events). */

export const CATEGORY_LABELS: Record<string, string> = {
    hackathon: 'Hackathon',
    meetup: 'Meetup',
    conference: 'Conference',
    networking: 'Networking',
};

// Platform labels — used where the actual platform matters (e.g. "Register on Eventbrite").
export const SOURCE_LABELS: Record<string, string> = {
    luma: 'Luma',
    eventbrite: 'Eventbrite',
    meetup: 'Meetup',
    mlh: 'MLH',
    company: 'Company',
    hackathon: 'the hackathon site',
};

/**
 * UX lanes — the three ways people actually browse: official company events,
 * hackathons, and local community events (Luma/Eventbrite/Meetup collapsed,
 * since the platform doesn't matter when you're looking for something to attend).
 */
export type Lane = 'company' | 'hackathon' | 'local';

export const LANE_LABELS: Record<Lane, string> = {
    company: 'Company',
    hackathon: 'Hackathon',
    local: 'Local',
};

export function laneOf(source: string, category?: string): Lane {
    if (source === 'company') return 'company';
    if (source === 'mlh' || source === 'hackathon' || category === 'hackathon') return 'hackathon';
    return 'local';
}

/** Lane including the "everything" feed state — what URL params resolve to. */
export type FeedLane = Lane | 'all';

/** Lane from URL params — `source` may be the 'local' pseudo-source; absence of both → 'all'. */
export function laneFromParams(source?: string | null, category?: string | null): FeedLane {
    if (source === 'company') return 'company';
    if (category === 'hackathon' || source === 'mlh' || source === 'hackathon') return 'hackathon';
    if (source === 'local') return 'local';
    return 'all';
}

/** Per-lane accent — kept subtle: a small dot + the hover border tint (shared by card + row). */
export const LANE_ACCENT: Record<Lane, { dot: string; hover: string; text: string }> = {
    company: { dot: 'bg-amber', hover: 'hover:border-amber/40', text: 'text-amber' },
    hackathon: { dot: 'bg-primary', hover: 'hover:border-primary/50', text: 'text-primary' },
    local: { dot: 'bg-light-200', hover: 'hover:border-light-200/40', text: 'text-light-200' },
};

export const MODE_LABELS: Record<string, string> = {
    offline: 'In person',
    online: 'Online',
    hybrid: 'Hybrid',
};

/** Region filter — the product focuses on North America (Canada-first), plus online. */
export const REGION_LABELS: Record<string, string> = {
    canada: 'Canada',
    us: 'United States',
    online: 'Online',
};

export const DATE_PRESETS = [
    { value: '', label: 'Upcoming' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
    { value: 'quarter', label: 'Next 3 months' },
    { value: 'half', label: 'Next 6 months' },
];

/** Tags shown on cards exclude the implicit baseline tag. */
export const HIDDEN_TAGS = ['tech'];
