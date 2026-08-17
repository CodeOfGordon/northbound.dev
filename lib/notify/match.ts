/**
 * Interest matching for the email digest. Deliberately dumb-simple for a
 * single-recipient product: fields within a rule AND together, rules OR.
 * Pure module — no imports beyond types, so it's trivially testable and safe
 * to reuse anywhere.
 */

export interface InterestRule {
    /** Human reason shown in the email row, e.g. "Hackathons". */
    label: string;
    category?: 'hackathon' | 'meetup' | 'conference' | 'networking';
    source?: string;
    region?: 'CA' | 'US' | 'ONLINE';
    /** Case-insensitive exact city match. */
    city?: string;
    /** Any-of, case-insensitive, against event.tags. */
    tags?: string[];
    /** Any-of, case-insensitive substring on title + description. */
    keywords?: string[];
    /** None-of keywords — veto within this rule only. */
    exclude?: string[];
    /**
     * Skip events starting sooner than this many days out. For hackathons the
     * point of the digest is planning ahead — a hackathon starting next week
     * has closed applications; hearing about it is noise.
     */
    minDaysOut?: number;
}

export interface EventLike {
    title: string;
    description: string;
    date: string; // YYYY-MM-DD
    city: string;
    tags: string[];
    source: string;
    category?: string;
    region?: string;
}

function addDays(ymd: string, n: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Labels of every rule the event matches — [] means "not interesting". */
export function matchEvent(event: EventLike, rules: InterestRule[], today: string): string[] {
    const haystack = `${event.title} ${event.description}`.toLowerCase();
    const tags = event.tags.map((t) => t.toLowerCase());

    return rules
        .filter((rule) => {
            if (rule.category && event.category !== rule.category) return false;
            if (rule.source && event.source !== rule.source) return false;
            if (rule.region && event.region !== rule.region) return false;
            if (rule.city && event.city.toLowerCase() !== rule.city.toLowerCase()) return false;
            if (rule.tags && !rule.tags.some((t) => tags.includes(t.toLowerCase()))) return false;
            if (rule.keywords && !rule.keywords.some((k) => haystack.includes(k.toLowerCase()))) return false;
            if (rule.exclude?.some((k) => haystack.includes(k.toLowerCase()))) return false;
            if (rule.minDaysOut && event.date < addDays(today, rule.minDaysOut)) return false;
            return true;
        })
        .map((rule) => rule.label);
}
