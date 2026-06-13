/** UI constants for filters, labels and chips (live data replaced the old sample events). */

export const CITIES = [
    'Toronto',
    'Mississauga',
    'Markham',
    'Vaughan',
    'Brampton',
    'Waterloo',
    'Ottawa',
    'Montreal',
    'Quebec City',
    'Online',
];

export const CATEGORY_LABELS: Record<string, string> = {
    hackathon: 'Hackathon',
    meetup: 'Meetup',
    conference: 'Conference',
    networking: 'Networking',
};

export const SOURCE_LABELS: Record<string, string> = {
    luma: 'Luma',
    eventbrite: 'Eventbrite',
    meetup: 'Meetup',
    mlh: 'MLH',
    company: 'Company',
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

/** Small flag/region indicator for cards + detail. Keyed by canonical country string. */
export const COUNTRY_FLAG: Record<string, string> = {
    Canada: '🇨🇦',
    'United States': '🇺🇸',
    Online: '🌐',
    'North America': '🌎',
};

export const DATE_PRESETS = [
    { value: '', label: 'Upcoming' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
];

/** Tags shown on cards exclude the implicit baseline tag. */
export const HIDDEN_TAGS = ['tech'];
