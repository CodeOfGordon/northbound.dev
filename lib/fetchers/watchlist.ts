/**
 * Watchlist fetcher: polls the official sites of curated named hackathons
 * (lib/data/watchlist.ts) and emits a CompanyStdEvent once a page announces a
 * future edition's dates. Date extraction is heuristic — month-name ranges like
 * "October 16–18, 2026" / "Sept 19-20" — and deliberately conservative: no
 * parseable future date → no doc (a stale site keeps last year's event out of
 * the feed because past dates are rejected).
 */
import { BROWSER_UA, monthNumber, todayISO } from './companies/shared';
import type { CompanyStdEvent } from './companies/shared';
import { WATCHLIST, type WatchlistEntry } from '@/lib/data/watchlist';

const pad = (n: number) => String(n).padStart(2, '0');

/** "October 16–18, 2026", "Sept 19 - 20, 2026", "Jan 30 – Feb 1, 2027", or single "March 28, 2026". */
const RANGE_RE =
    /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–—]\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/g;
const SINGLE_RE = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})/g;

interface ParsedRange {
    start: string;
    end: string;
}

/**
 * First future date range on the page (hero copy is near the top, so first
 * plausible match wins). Bounded to ~13 months out to reject countdown noise.
 */
export function extractFutureRange(text: string, today: string): ParsedRange | null {
    const maxISO = `${parseInt(today.slice(0, 4), 10) + 2}-01-01`;
    const currentYear = parseInt(today.slice(0, 4), 10);

    const candidates: ParsedRange[] = [];

    for (const m of text.matchAll(RANGE_RE)) {
        const sm = monthNumber(m[1]);
        const em = m[3] ? monthNumber(m[3]) : sm;
        if (!sm || !em) continue;
        const sd = parseInt(m[2], 10);
        const ed = parseInt(m[4], 10);
        if (sd < 1 || sd > 31 || ed < 1 || ed > 31) continue;
        // Explicit year applies to the end; start inherits it (Dec→Jan wraps back one).
        const year = m[5] ? parseInt(m[5], 10) : currentYear;
        const startYear = em < sm ? year - 1 : year;
        const start = `${startYear}-${pad(sm)}-${pad(sd)}`;
        const end = `${year}-${pad(em)}-${pad(ed)}`;
        if (end < start) continue;
        candidates.push({ start, end });
        // Yearless ranges may belong to next year — try that reading too.
        if (!m[5]) candidates.push({ start: `${startYear + 1}-${pad(sm)}-${pad(sd)}`, end: `${year + 1}-${pad(em)}-${pad(ed)}` });
    }
    for (const m of text.matchAll(SINGLE_RE)) {
        const mm = monthNumber(m[1]);
        const dd = parseInt(m[2], 10);
        if (!mm || dd < 1 || dd > 31) continue;
        const d = `${m[3]}-${pad(mm)}-${pad(dd)}`;
        candidates.push({ start: d, end: d });
    }

    return candidates.find((c) => c.start >= today && c.start < maxISO) ?? null;
}

/**
 * Searchable text from a page. Most of these sites are JS-rendered SPAs whose
 * body text is empty in raw HTML — the title + meta descriptions are often the
 * only server-side text (verified 2026-08), so they're pulled out explicitly
 * before tags (and their attribute content) are stripped.
 */
function pageText(html: string): string {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const metas = [...html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]*>/gi)].map((m) => m[1]);
    const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    return [title, ...metas, body].join(' ').replace(/\s+/g, ' ');
}

async function fetchEntry(entry: WatchlistEntry, today: string): Promise<CompanyStdEvent | null> {
    const url = `https://${entry.host}/`;
    let range: ParsedRange | null = null;
    try {
        const res = await fetch(url, {
            headers: { 'user-agent': BROWSER_UA, accept: 'text/html' },
            signal: AbortSignal.timeout(10_000),
            redirect: 'follow',
        });
        if (!res.ok) throw new Error(`${entry.host} → ${res.status}`);
        range = extractFutureRange(pageText(await res.text()), today);
    } catch (e) {
        console.warn(`watchlist: ${entry.host} fetch failed — ${(e as Error).message}`);
    }
    // SPA pages carry no dates in raw HTML — fall back to the curated next-edition
    // dates, guarded by the same future check so a past edition self-retires.
    if (!range && entry.knownNext && entry.knownNext.start >= today) {
        range = { start: entry.knownNext.start, end: entry.knownNext.end ?? entry.knownNext.start };
    }
    if (!range) return null; // next edition not announced — stay dormant

    return {
        _std: true,
        _provider: 'watchlist',
        _company: entry.name,
        id: entry.host,
        title: entry.name,
        url,
        online: false,
        city: entry.city,
        country: entry.country,
        date: range.start,
        endDate: range.end !== range.start ? range.end : undefined,
        description: `${entry.name} — ${entry.school}'s hackathon. ${entry.note ?? ''} Details and registration on the event website.`
            .replace(/\s+/g, ' ')
            .trim(),
        category: 'hackathon',
        isFree: true,
    };
}

export async function fetchWatchlist(): Promise<unknown[]> {
    const today = todayISO();
    const results = await Promise.all(
        WATCHLIST.map(async (entry) => {
            try {
                return await fetchEntry(entry, today);
            } catch (e) {
                console.warn(`watchlist: ${entry.host} skipped — ${(e as Error).message}`);
                return null;
            }
        }),
    );
    return results.filter(Boolean) as unknown[];
}
