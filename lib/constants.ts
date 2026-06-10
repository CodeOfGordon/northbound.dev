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

export const DATE_PRESETS = [
    { value: '', label: 'Upcoming' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
];

/** Tags shown on cards exclude the implicit baseline tag. */
export const HIDDEN_TAGS = ['tech'];
