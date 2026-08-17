/**
 * Devpost — the largest hackathon aggregator beyond MLH. Public JSON API at
 * devpost.com/api/hackathons, no auth. Two slices: `challenge_type=online`
 * (location-agnostic, always attendable from NA) and `challenge_type=in-person`
 * (worldwide — the geo gate keeps US/CA and drops the rest as INTL). Devpost
 * blocks named AI-crawler UAs, so we send a browser UA. Dates come as a display
 * string → parseDevpostRange; `open_state` maps to applicationStatus.
 */
import { BROWSER_UA, parseDevpostRange } from './companies/shared';
import type { CompanyStdEvent } from './companies/shared';
import { MAX_HACKATHON_DAYS, MAX_ITEMS } from './config';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = 'https://devpost.com/api/hackathons';
const PER_PAGE = 30;
const SLICES = ['online', 'in-person'] as const;

async function fetchPage(page: number, challengeType: string): Promise<{ hackathons?: any[]; meta?: any }> {
    const url =
        `${API}?challenge_type[]=${challengeType}&status[]=open&status[]=upcoming` +
        `&order_by=deadline&per_page=${PER_PAGE}&page=${page}`;
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': BROWSER_UA } });
    if (!res.ok) throw new Error(`devpost ${challengeType} page ${page} → ${res.status}`);
    return res.json();
}

export async function fetchDevpost(): Promise<unknown[]> {
    const out: CompanyStdEvent[] = [];
    const maxPages = Math.max(1, Math.ceil(MAX_ITEMS / PER_PAGE)); // per slice

    for (const slice of SLICES) {
        for (let page = 1; page <= maxPages; page++) {
            let data: { hackathons?: any[]; meta?: any };
            try {
                data = await fetchPage(page, slice);
            } catch (e) {
                console.warn(`devpost: ${(e as Error).message}`);
                break;
            }
            const items = data.hackathons ?? [];
            if (!items.length) break;

            for (const h of items) {
                const dates = parseDevpostRange(String(h.submission_period_dates ?? ''));
                if (!dates) continue; // unparseable window — skip rather than guess
                const span = (Date.parse(dates.end) - Date.parse(dates.start)) / 86_400_000;
                if (span > MAX_HACKATHON_DAYS) continue; // perpetual / template challenge

                const online =
                    slice === 'online' ||
                    h.displayed_location?.icon === 'globe' ||
                    h.displayed_location?.location === 'Online';
                const themes = Array.isArray(h.themes) ? h.themes.map((t: any) => t.name).filter(Boolean) : [];
                const thumb = typeof h.thumbnail_url === 'string' ? h.thumbnail_url : '';
                const image = thumb.startsWith('//') ? `https:${thumb}` : thumb;
                const organizer = h.organization_name || 'Devpost';
                const description = [
                    `${organizer} hackathon`,
                    themes.length ? themes.join(', ') : '',
                    h.registrations_count ? `${h.registrations_count} registered` : '',
                ]
                    .filter(Boolean)
                    .join(' · ');

                out.push({
                    _std: true,
                    _provider: 'devpost',
                    _company: organizer,
                    id: String(h.id ?? h.url),
                    title: String(h.title ?? '').slice(0, 100),
                    url: h.url,
                    image,
                    online,
                    // In-person items carry "City, ST" — classifyRegion resolves it and
                    // the INTL gate drops non-NA venues before upsert.
                    city: online ? 'Online' : h.displayed_location?.location ?? 'Online',
                    date: dates.start,
                    endDate: dates.end !== dates.start ? dates.end : undefined,
                    description,
                    category: 'hackathon',
                    isFree: true,
                    // Registration on Devpost is possible while a listing is open OR
                    // upcoming (the submission window starting later doesn't block
                    // joining) — both map to 'open'. See ADR-019.
                    applicationStatus: h.open_state === 'open' || h.open_state === 'upcoming' ? 'open' : 'unknown',
                    applicationDeadline: dates.end,
                    // No _regions: online events default to NA-attendable in the geo gate;
                    // passing ['Online'] would read as a non-NA hint and drop them.
                });
            }

            const total = data.meta?.total_count ?? items.length;
            if (page * PER_PAGE >= total) break;
        }
    }

    return out;
}
