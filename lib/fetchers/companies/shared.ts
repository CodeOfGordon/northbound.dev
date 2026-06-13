/**
 * Shared contract for the bespoke company-platform adapters in this directory.
 * Each adapter maps one events platform (AWS directory API, Microsoft Reactor,
 * NVIDIA AEM calendar, ...) into CompanyStdEvent; normalize.ts has a single
 * mapper for this shape, so adding a platform never touches the normalizer.
 */

export interface CompanyStdEvent {
    _std: true;
    /** Platform key (config provider name) — used for sourceId namespacing + logs. */
    _provider: string;
    /** Display organizer, e.g. 'AWS', 'Microsoft Reactor'. */
    _company: string;
    /** Platform-stable id when the source has one; fingerprint dedups regardless. */
    id?: string;
    title: string;
    url: string;
    description?: string;
    image?: string;
    /** Omit when unknown; use 'Online' for virtual events. */
    city?: string;
    country?: string;
    venue?: string;
    online: boolean;
    /** Overrides the online flag when a source distinguishes hybrid. */
    mode?: 'online' | 'offline' | 'hybrid';
    /** Either UTC ISO instants + IANA zone ... */
    startISO?: string;
    endISO?: string;
    timezone?: string;
    /** ... or already-local parts for date-only sources (YYYY-MM-DD / HH:MM). */
    date?: string;
    endDate?: string;
    time?: string;
    endTime?: string;
    isFree?: boolean;
    price?: string;
    category?: 'hackathon' | 'meetup' | 'conference' | 'networking';
    /** Source-provided audience/region tokens (e.g. ['North America','EMEA']) — geo gate uses these when the city is ambiguous/online. */
    _regions?: string[];
}

/**
 * Some company sites (NVIDIA, Figma) blanket-block AI-crawler UA tokens, and
 * Tesla/Databricks sit behind TLS-fingerprinting CDNs where only Node's native
 * fetch with a browser-ish UA passes. Neutral product UA for those adapters.
 */
export const BROWSER_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Today's date string in a zone (default: the site's home zone). */
export function todayISO(timeZone = 'America/Toronto'): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

const pad = (s: string | number) => String(s).padStart(2, '0');

/**
 * Hand-edited US-style dates → YYYY-MM-DD (NVIDIA's calendar mixes YYYY-MM-DD,
 * M/D/YY, MM-DD-YY, MM-DD-YYYY and the odd 'TBC'). Month-first for short forms,
 * matching JS Date semantics. Returns null when unparseable — skip the item.
 */
export function parseLooseUSDate(input: string): string | null {
    const t = input.trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`;
    return null;
}

const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** 'June' / 'JUL' / 'sept' → 1-12, or null. */
export function monthNumber(name: string): number | null {
    return MONTHS[name.trim().slice(0, 3).toLowerCase()] ?? null;
}

/**
 * Year inference for sources that publish month+day with no year (Google's
 * gallery, Snowflake's cards): anchor to the reference year, but treat dates
 * more than ~6 months behind the reference as next year (Dec→Jan wrap).
 */
export function inferYearDate(month: number, day: number, refISO: string): string {
    const refYear = parseInt(refISO.slice(0, 4), 10);
    const candidate = `${refYear}-${pad(month)}-${pad(day)}`;
    const wrapPoint = new Date(`${refISO}T00:00:00Z`).getTime() - 183 * 86_400_000;
    if (new Date(`${candidate}T00:00:00Z`).getTime() < wrapPoint) {
        return `${refYear + 1}-${pad(month)}-${pad(day)}`;
    }
    return candidate;
}
