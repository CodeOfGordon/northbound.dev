/**
 * Microsoft Reactor via its public JSON API (developer.microsoft.com/reactor/api/events,
 * no culture prefix — the /en-us/ variant 404s). Unauthenticated GET; returns upcoming
 * events only, sorted ascending, 10 per page with currentPage/totalPages envelopes.
 * startDateTimeUtc/endDateTimeUtc are true UTC instants (the *User/timeZoneOffset
 * fields follow a timezone cookie and are meaningless for cookieless fetches).
 * Verified live 2026-06-10.
 */
import { getJSON } from '../util';
import { MAX_ITEMS } from '../config';
import { CompanyStdEvent, todayISO } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = 'https://developer.microsoft.com/reactor/api/events';

export async function fetchReactor(src: { company: string }): Promise<CompanyStdEvent[]> {
    const out: CompanyStdEvent[] = [];
    // Events ending before today (UTC) have ended; the API is upcoming-only, but be safe.
    const cutoff = new Date(`${todayISO()}T00:00:00Z`).getTime();

    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && out.length < MAX_ITEMS) {
        const res = await getJSON<{ totalPages?: number; items?: any[] }>(`${API}?page=${page}`);
        totalPages = res.totalPages ?? page;
        page++;

        for (const ev of res.items ?? []) {
            // Series entries have GUID ids, no own schedule/city — individual sessions cover them.
            if (!ev?.id || !ev.title || !ev.startDateTimeUtc || ev.isSeries) continue;
            const end = ev.endDateTimeUtc ?? ev.startDateTimeUtc;
            if (new Date(end).getTime() < cutoff) continue;

            const mode: CompanyStdEvent['mode'] = ev.isHybrid
                ? 'hybrid'
                : ev.hasLivestreamSession && !ev.hasInPersonSession
                    ? 'online'
                    : 'offline';

            // regions: string[] (e.g. ['Asia Pacific','Latin America','North America']).
            const regions: string[] = Array.isArray(ev.regions)
                ? ev.regions.filter((r: any): r is string => typeof r === 'string' && r.length > 0)
                : [];

            out.push({
                _std: true,
                _provider: 'reactor',
                _company: src.company,
                id: String(ev.id),
                title: String(ev.title).trim(),
                url: ev.primaryRegistrationUrl
                    ?? `https://developer.microsoft.com/en-us/reactor/events/${ev.id}/`,
                description: ev.description ? String(ev.description).trim() : undefined,
                city: ev.locationDisplayCity ?? ev.location ?? undefined,
                venue: ev.locationDisplayAddress ?? undefined,
                online: mode === 'online',
                mode,
                startISO: ev.startDateTimeUtc,
                endISO: ev.endDateTimeUtc ?? undefined,
                timezone: 'UTC',
                ...(regions.length ? { _regions: regions } : {}),
            });
        }
    }

    return out.slice(0, MAX_ITEMS);
}
