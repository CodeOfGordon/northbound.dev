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
