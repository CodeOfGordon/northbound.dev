/**
 * Interest matching for the digest. Deliberately dumb-simple: fields within a
 * rule AND together, rules OR. Pure module — no imports beyond types, so it's
 * trivially testable and safe to reuse anywhere.
 */

export interface InterestRule {
    /** Human reason shown in the email row, e.g. "Hackathons · Canada". */
    label: string;
    category?: string;
    /** Any-of categories (used where one topic spans several). */
    categories?: string[];
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
     * Only events whose applications are still open (or not yet open) for this
     * subscriber. Replaced the old event-start lead-time filter (`minDaysOut`):
     * how far away a hackathon is says nothing about whether you can still
     * apply — HackPrinceton (Nov) closed applications in September, and the
     * lead-time gate also hid deadline reminders. (ADR-029)
     */
    requireApplicable?: boolean;
    /**
     * Require a known travel-reimbursement policy (enrichment-derived). Only
     * meaningful for in-person events; online events never match it.
     */
    travel?: 'yes';
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
    mode?: string;
    enrichment?: { travel?: { status?: string } };
}

export interface MatchContext {
    /** Resolved for this subscriber at compose time (lib/hackathon.ts applicationState). */
    applicationsClosed?: boolean;
}

/** Labels of every rule the event matches — [] means "not interesting". */
export function matchEvent(event: EventLike, rules: InterestRule[], ctx: MatchContext = {}): string[] {
    const haystack = `${event.title} ${event.description}`.toLowerCase();
    const tags = event.tags.map((t) => t.toLowerCase());

    return rules
        .filter((rule) => {
            if (rule.category && event.category !== rule.category) return false;
            if (rule.categories && !rule.categories.includes(event.category ?? '')) return false;
            if (rule.source && event.source !== rule.source) return false;
            if (rule.region && event.region !== rule.region) return false;
            if (rule.city && event.city.toLowerCase() !== rule.city.toLowerCase()) return false;
            if (rule.tags && !rule.tags.some((t) => tags.includes(t.toLowerCase()))) return false;
            if (rule.keywords && !rule.keywords.some((k) => haystack.includes(k.toLowerCase()))) return false;
            if (rule.exclude?.some((k) => haystack.includes(k.toLowerCase()))) return false;
            if (rule.requireApplicable && ctx.applicationsClosed) return false;
            // Unknown travel policy is not a match — we only promise what we verified.
            if (rule.travel === 'yes' && event.enrichment?.travel?.status !== 'yes') return false;
            return true;
        })
        .map((rule) => rule.label);
}

/* ---- Subscriber preferences → rules ------------------------------------- */

export interface SubscriberPrefs {
    topics: string[];
    regions: string[];
    usTravelOnly: boolean;
}

const REGION_LABEL: Record<string, string> = { CA: 'Canada', US: 'United States', ONLINE: 'Online' };
/** "Community" bundles the non-hackathon, non-company categories. */
const COMMUNITY_CATEGORIES = ['meetup', 'conference', 'networking'];

/**
 * Expand a subscriber's checkbox preferences into matcher rules — one per
 * (topic × region) pair, so the email can name exactly why each event matched.
 */
export function rulesForSubscriber(prefs: SubscriberPrefs): InterestRule[] {
    const rules: InterestRule[] = [];

    for (const region of prefs.regions as ('CA' | 'US' | 'ONLINE')[]) {
        const where = REGION_LABEL[region] ?? region;

        for (const topic of prefs.topics) {
            if (topic === 'hackathon') {
                // Travel filter applies to US in-person only: online hackathons have
                // nothing to reimburse, and a CA subscriber is local to CA events.
                const travelScoped = region === 'US' && prefs.usTravelOnly;
                rules.push({
                    label: travelScoped ? `Hackathons · ${where} (travel covered)` : `Hackathons · ${where}`,
                    category: 'hackathon',
                    region,
                    requireApplicable: true,
                    ...(travelScoped ? { travel: 'yes' as const } : {}),
                });
            } else if (topic === 'company') {
                rules.push({ label: `Company events · ${where}`, source: 'company', region });
            } else if (topic === 'community') {
                rules.push({ label: `Meetups & conferences · ${where}`, categories: COMMUNITY_CATEGORIES, region });
            }
        }
    }

    return rules;
}
