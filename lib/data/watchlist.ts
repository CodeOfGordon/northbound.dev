/**
 * Curated named hackathons whose editions don't (reliably) appear in MLH season
 * data or the aggregator APIs — mostly the independent university majors. The
 * watchlist fetcher polls each official site nightly and creates an event doc
 * once a future edition's dates are announced on the page; until then the entry
 * is dormant (no doc). If an event later shows up via MLH too, the fingerprint
 * (title|date|city) dedups it. Hosts verified 2026-08-16 (ADR-019).
 */
export interface WatchlistEntry {
    /** Display name — becomes the event title (and organizer). */
    name: string;
    /** Canonical hostname of the official site, stable across yearly editions. */
    host: string;
    city: string;
    country: string;
    school: string;
    /** Extra sentence appended to the description (e.g. eligibility limits). */
    note?: string;
    /**
     * Curated next-edition dates for sites whose pages are JS-rendered blanks
     * (most of these are SPAs — verified 2026-08: hackmit.org's raw HTML is 14
     * chars of text). Used only when page extraction finds nothing, and subject
     * to the same future-date guard, so a past knownNext self-retires. Refresh
     * these when the enrich job's summary flags a dormant host.
     */
    knownNext?: { start: string; end?: string };
}

export const WATCHLIST: WatchlistEntry[] = [
    { name: 'Cal Hacks', host: 'calhacks.io', city: 'San Francisco', country: 'United States', school: 'UC Berkeley' },
    { name: 'PennApps', host: 'pennapps.com', city: 'Philadelphia', country: 'United States', school: 'University of Pennsylvania' },
    // BigRed//Hacks (Cornell) deliberately NOT listed: MLH season data covers it, and
    // title drift ("BigRed//Hacks 2026" vs ours) defeats fingerprint dedup — a
    // watchlist entry created a visible duplicate on first live run. Re-add only
    // if it ever drops out of MLH.
    { name: 'SproutGT', host: 'sprout.hack.gt', city: 'Atlanta', country: 'United States', school: 'Georgia Tech', note: 'Open to Georgia Tech students only.' },
    // hackharvard.io 301s here since ~2026 — track the canonical host. Dates per official site/aggregators 2026-08.
    { name: 'HackHarvard', host: 'hhuh.io', city: 'Cambridge', country: 'United States', school: 'Harvard University', knownNext: { start: '2026-10-16', end: '2026-10-18' } },
    // Dates confirmed via HackMIT's own announcements (apps closed Jul 4, 2026).
    { name: 'HackMIT', host: 'hackmit.org', city: 'Cambridge', country: 'United States', school: 'MIT', knownNext: { start: '2026-09-19', end: '2026-09-20' } },
    { name: 'HooHacks', host: 'hoohacks.io', city: 'Charlottesville', country: 'United States', school: 'University of Virginia' },
    { name: 'YHack', host: 'yhack.org', city: 'New Haven', country: 'United States', school: 'Yale University' },
    // TreeHacks 2027 per its site/announcements (2026-09); applications Nov 1 (priority Oct 19 is Stanford-only).
    { name: 'TreeHacks', host: 'treehacks.com', city: 'Stanford', country: 'United States', school: 'Stanford University', knownNext: { start: '2027-02-12', end: '2027-02-14' } },
    // Not in MLH's 2027 roster as of 2026-09, and its Fall 2026 deadline (Sep 28) was announced
    // mainly on social media — the miss that prompted ADR-029. Re-check for an MLH duplicate
    // (title drift defeats fingerprint dedup) if MLH later lists it.
    { name: 'HackPrinceton', host: 'hackprinceton.com', city: 'Princeton', country: 'United States', school: 'Princeton University', knownNext: { start: '2026-11-13', end: '2026-11-15' } },
    { name: 'McHacks', host: 'mchacks.ca', city: 'Montreal', country: 'Canada', school: 'McGill University' },
];
