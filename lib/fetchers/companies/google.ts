/**
 * Google developer events: developers.google.com/events is a static devsite page
 * whose curated "Upcoming events" gallery sits between '<h2 id="upcoming-events"'
 * and the 'devsite-events-header-row' directory table; each gallery item is a
 * '<div class="devsite-landing-row-item"' block with <h3 id="{slug}"><a>{title}</a>,
 * a meta <p> of the form 'June 9-10 (Frankfurt) | In-person', then a description
 * <p>. Dates are free text, usually without a year; 'Ongoing | Online' series
 * carry no real date and are skipped. Date-only — the page never gives times.
 */
import { MAX_ITEMS } from '../config';
import { stripHtml } from '../util';
import { BROWSER_UA, inferYearDate, monthNumber, todayISO } from './shared';
import type { CompanyStdEvent } from './shared';

// hl=en + accept-language pin the page to English: without them devsite randomly
// serves machine-translated variants whose heading ids (our slugs/markers) are
// translated away.
const PAGE = 'https://developers.google.com/events?hl=en';

const pad = (n: number) => String(n).padStart(2, '0');

/** Decode entity-encoded hrefs and drop utm_* tracking params. */
function cleanUrl(raw: string): string | null {
    try {
        const url = new URL(raw.replace(/&amp;/g, '&'));
        for (const key of [...url.searchParams.keys()]) {
            if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
        }
        return url.toString();
    } catch {
        return null;
    }
}

/**
 * 'June 9-10', 'May 7', 'April 2 - May 18', optional ', YYYY' suffix; the year
 * is usually absent — infer it (with Dec→Jan wrap) via inferYearDate. Returns
 * null for 'Ongoing' or anything else unparseable.
 */
function parseDateRange(text: string, today: string): { date: string; endDate?: string } | null {
    const m = text.match(/^([A-Za-z]+)\s+(\d{1,2})(?:\s*[-–]\s*(?:([A-Za-z]+)\s+)?(\d{1,2}))?(?:,\s*(\d{4}))?$/);
    if (!m) return null;
    const startMonth = monthNumber(m[1]);
    if (!startMonth) return null;
    const make = (month: number, day: number) =>
        m[5] ? `${m[5]}-${pad(month)}-${pad(day)}` : inferYearDate(month, day, today);

    const date = make(startMonth, parseInt(m[2], 10));
    if (!m[4]) return { date };
    const endMonth = m[3] ? monthNumber(m[3]) : startMonth;
    if (!endMonth) return null;
    let endDate = make(endMonth, parseInt(m[4], 10));
    // Independent year inference can put a Jan end before a Dec start — bump it.
    if (endDate < date) endDate = `${parseInt(endDate.slice(0, 4), 10) + 1}${endDate.slice(4)}`;
    return { date, endDate };
}

export async function fetchGoogle(src: { company: string }): Promise<CompanyStdEvent[]> {
    const res = await fetch(PAGE, {
        headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`GET ${PAGE} → ${res.status}`);
    const html = await res.text();

    // Attribute layout around the <h2> varies between devsite frontends — anchor
    // on the id alone.
    const from = html.indexOf('id="upcoming-events"');
    if (from === -1) throw new Error('upcoming-events section not found');
    const to = html.indexOf('devsite-events-header-row', from);
    const section = html.slice(from, to === -1 ? undefined : to);

    const today = todayISO();
    const events: CompanyStdEvent[] = [];
    for (const block of section.split('<div class="devsite-landing-row-item"').slice(1)) {
        const h3 = block.match(/<h3[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/);
        const href = block.match(/<a\s+href="([^"]+)"/);
        if (!h3 || !href) continue;
        const title = stripHtml(h3[2]);
        const url = cleanUrl(href[1]);
        if (!title || !url) continue;

        // First <p> containing '|' is 'date (place) | format'; the next <p> is the
        // description. (The opener must not also match <picture> — hence (?:\s|>).)
        const ps = [...block.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)].map((p) => stripHtml(p[1]));
        const metaIdx = ps.findIndex((p) => p.includes('|'));
        if (metaIdx === -1) continue;
        const [rawDate = '', format = ''] = ps[metaIdx].split('|').map((s) => s.trim());

        const dates = parseDateRange(rawDate.replace(/\([^)]*\)/g, '').trim(), today);
        if (!dates || (dates.endDate ?? dates.date) < today) continue;

        // The paren token is the city for in-person events ('Frankfurt'); online
        // series reuse it for cadence ('Wednesdays'), so ignore it there.
        const online = format === 'Online';
        const paren = rawDate.match(/\(([^)]+)\)/);
        const image = block.match(/<img[^>]*\bsrc="(https:\/\/developers\.google\.com\/static[^"]+)"/);
        events.push({
            _std: true,
            _provider: 'google',
            _company: src.company,
            id: h3[1],
            title,
            url,
            image: image?.[1],
            description: ps[metaIdx + 1] || undefined,
            city: online ? 'Online' : paren?.[1].trim(),
            online,
            ...dates,
        });
    }
    return events.slice(0, MAX_ITEMS);
}
