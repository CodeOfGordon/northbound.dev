/** Display helpers for the stored string formats (date YYYY-MM-DD, time HH:MM 24h). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(date: string) {
    const [y, m, d] = date.split('-').map(Number);
    return { y, m, d, day: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Mon, Jun 15" (year appended when not the current year). */
export function formatDate(date: string): string {
    const { y, m, d, day } = parts(date);
    const year = y === new Date().getFullYear() ? '' : `, ${y}`;
    return `${DAYS[day]}, ${MONTHS[m - 1]} ${d}${year}`;
}

/** "Jun 15" — no weekday. */
export function monthDay(date: string): string {
    const { m, d } = parts(date);
    return `${MONTHS[m - 1]} ${d}`;
}

/**
 * Date-group header for the timeline: a relative label (Today / Tomorrow) or the
 * long weekday, plus a "Jun 15" secondary. `today`/`tomorrow` are YYYY-MM-DD in
 * the feed's timezone, passed in so the component stays free of Date/tz logic.
 */
export function dayHeader(date: string, today: string, tomorrow: string): { label: string; sub: string } {
    const { m, d, day } = parts(date);
    const sub = `${MONTHS[m - 1]} ${d}`;
    if (date === today) return { label: 'Today', sub };
    if (date === tomorrow) return { label: 'Tomorrow', sub };
    return { label: DAYS_LONG[day], sub };
}

/** "Jun 15" or "Jun 15 – 17" / "Jun 30 – Jul 2" for multi-day events. */
export function formatDateRange(date: string, endDate?: string): string {
    const a = parts(date);
    const label = `${MONTHS[a.m - 1]} ${a.d}`;
    if (!endDate || endDate === date) return label;
    const b = parts(endDate);
    return a.m === b.m ? `${label} – ${b.d}` : `${label} – ${MONTHS[b.m - 1]} ${b.d}`;
}

/** Badge pieces for the card corner: { month: 'JUN', day: '15' }. */
export function dateBadge(date: string): { month: string; day: string } {
    const { m, d } = parts(date);
    return { month: MONTHS[m - 1].toUpperCase(), day: String(d) };
}

/** "6:30 PM" from "18:30". */
export function formatTime(time: string): string {
    const [h, min] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(min).padStart(2, '0')} ${period}`;
}

/** Compact relative time: "just now", "5 min ago", "3 h ago", "2 d ago", else a date. */
export function timeAgo(date: Date | string | number): string {
    const then = new Date(date).getTime();
    if (Number.isNaN(then)) return '';
    const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day} d ago`;
    return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** End time defaulted to +1h for calendar export (lib requires an end when a start exists). */
export function defaultEndTime(time: string): string {
    const [h, min] = time.split(':').map(Number);
    if (h >= 23) return '23:59'; // don't roll past midnight — keep it same-day
    return `${String(h + 1).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/* ---- Location/price display guards ----------------------------------------
 * Scraped sources fall back to placeholder strings ('TBA', 'North America', '')
 * for unknown venue/country/city. These formatters are the single place that
 * decides what a reader sees for each degenerate case — components must not
 * render the raw fields.
 */

const PLACEHOLDER = /^(tba|tbd|hybrid event)$/i;
/** Non-location country strings that carry no display value on their own. */
const NON_COUNTRY = /^(online|north america|international)$/i;

export function isPlaceholderLoc(v?: string | null): boolean {
    return !v || !v.trim() || PLACEHOLDER.test(v.trim());
}

/** Venue for the detail aside — null means "unknown" (caller renders a muted fallback). */
export function formatVenue(venue: string | undefined, mode: string): string | null {
    if (mode === 'online') return 'Online';
    if (isPlaceholderLoc(venue) || /^online$/i.test(venue!.trim())) return null;
    return venue!.trim();
}

/** "City, Country" sub-line with unknown halves dropped — null when nothing real survives. */
export function formatLocation({ city, country }: { city: string; country: string }): string | null {
    const c = isPlaceholderLoc(city) ? '' : city.trim();
    const k = isPlaceholderLoc(country) || NON_COUNTRY.test(country.trim()) ? '' : country.trim();
    if (c && k) return `${c}, ${k}`;
    return c || k || null;
}

/** Card/row pin label — always renders something; falls back region → generic. */
export function formatCityLabel(e: { city: string; country: string; region?: string; mode: string }): string {
    if (e.mode === 'online') return 'Online';
    if (!isPlaceholderLoc(e.city)) return e.city.trim();
    if (e.region === 'CA') return 'Canada';
    if (e.region === 'US') return 'United States';
    return formatLocation(e) ?? 'Location TBA';
}

/**
 * Flag for cards/rows, keyed off the derived region (set on every doc) so
 * presence is predictable; country-name fallback covers region-less docs.
 * Unknown/INTL → no flag rather than a vague globe.
 */
export function eventFlag(e: { region?: string; country: string }): string {
    if (e.region === 'CA') return '🇨🇦';
    if (e.region === 'US') return '🇺🇸';
    if (e.region === 'ONLINE') return '🌐';
    const byCountry: Record<string, string> = { Canada: '🇨🇦', 'United States': '🇺🇸', Online: '🌐' };
    return byCountry[e.country] ?? '';
}

/**
 * Price for any surface. `kind` lets list views distinguish paid from
 * data-missing (previously indistinguishable) without asserting a price we
 * don't have: 'unknown' renders as nothing on cards, "Price not listed" on detail.
 */
export function formatPrice(isFree?: boolean, price?: string): { label: string; kind: 'free' | 'paid' | 'unknown' } {
    const p = price?.trim() ?? '';
    if (isFree === true || /^(free|\$?0(\.00?)?)$/i.test(p)) return { label: 'Free', kind: 'free' };
    if (p) return { label: p, kind: 'paid' };
    if (isFree === false) return { label: 'Paid', kind: 'paid' };
    return { label: '', kind: 'unknown' };
}

/** Month-group header for the horizon timeline: { label: 'September', sub: '2026' }. */
export function monthHeader(ym: string): { label: string; sub: string } {
    const [y, m] = ym.split('-').map(Number);
    const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return { label: LONG[m - 1] ?? ym, sub: String(y) };
}

/** True when `ts` is more than `days` old — kept here so render paths stay Date.now()-free. */
export function olderThanDays(ts: Date | string | number, days: number): boolean {
    const then = new Date(ts).getTime();
    if (Number.isNaN(then)) return false;
    return Date.now() - then > days * 86_400_000;
}
