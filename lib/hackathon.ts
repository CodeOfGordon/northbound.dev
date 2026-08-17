/**
 * Application/travel signal resolution for hackathon events — the single place
 * that merges the scrape-owned fields (Devpost open_state) with the
 * enrichment subdocument (site/FAQ heuristics + curated overrides). Components
 * render from these signals only, never from the raw fields.
 */
import type { EventDoc } from '@/lib/events';

export interface ApplicationSignal {
    status: 'open' | 'closed' | 'not_yet' | 'unknown';
    deadline?: string; // YYYY-MM-DD
}

export interface TravelSignal {
    status: 'yes' | 'no' | 'unknown';
    amount?: string;
    evidence?: string;
    checkedAt?: string;
    curated: boolean;
    /** 'prior-edition' = seen at a past edition, not confirmed for this one. */
    basis?: 'current' | 'prior-edition';
    year?: number;
    /** Ready-to-render phrase — keeps every surface wording this the same way. */
    label: string;
}

/** Today in the feed's home zone — string date, lexical compare (I5). */
function todayToronto(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

/**
 * Scrape-owned status wins when it's a real signal (it refreshes nightly from
 * the platform API); enrichment fills in for sites we scan ourselves. A passed
 * deadline forces 'closed' regardless — stale "open" between checks must not
 * show as actionable. Not hackathon-gated: any event whose source ever supplies
 * application fields gets the same treatment (today that's Devpost + the
 * enrichment pass; events without the fields resolve to 'unknown').
 */
export function applicationSignal(e: EventDoc): ApplicationSignal {
    const scraped = e.applicationStatus && e.applicationStatus !== 'unknown' ? e.applicationStatus : undefined;
    const enriched = e.enrichment?.application;
    const status = scraped ?? (enriched?.status ?? 'unknown');
    const deadline = e.applicationDeadline ?? enriched?.deadline;
    if (deadline && deadline < todayToronto()) return { status: 'closed', deadline };
    return { status, deadline };
}

/**
 * Travel support for in-person North-American hackathons. Null = don't render
 * anything (not a hackathon / online / outside US+CA). 'unknown' is a real
 * state for US events ("not listed — check the site"); for CA events only a
 * known yes/no is worth a row (most CA events are local to the audience).
 */
export function travelSignal(e: EventDoc): TravelSignal | null {
    if (e.category !== 'hackathon' || e.mode === 'online') return null;
    if (e.region !== 'US' && e.region !== 'CA') return null;
    const t = e.enrichment?.travel;
    const status = t?.status ?? 'unknown';
    const prior = t?.basis === 'prior-edition';
    const signal: TravelSignal = {
        status,
        amount: t?.amount,
        evidence: t?.evidence,
        checkedAt: e.enrichment?.checkedAt,
        curated: e.enrichment?.source === 'curated',
        basis: t?.basis,
        year: t?.year,
        // Never state a past edition's policy as this year's commitment.
        label:
            status === 'yes'
                ? prior
                    ? `Travel reimbursement offered in ${t?.year ?? 'past years'} — not yet confirmed for this edition`
                    : `Travel reimbursement offered${t?.amount ? ` · ${t.amount}` : ''}`
                : status === 'no'
                  ? prior
                      ? `No travel reimbursement in ${t?.year ?? 'past years'}`
                      : 'No travel reimbursement'
                  : 'Travel support not listed — check the event site',
    };
    if (e.region === 'CA' && signal.status === 'unknown') return null;
    return signal;
}
