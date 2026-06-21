/**
 * ETHGlobal — Web3 hackathons. The /events route is an RSC app with no JSON API;
 * requesting it with the `RSC: 1` header returns a Flight payload containing the
 * full `"events":[...]` catalog in one shot. We keep upcoming hackathons that are
 * virtual or in US/CA. Low volume (mostly the recurring virtual ETHOnline), but a
 * single cheap fetch. Banner URLs are 1-hour-presigned, so we store no image and
 * let the card fall back rather than persist a URL that breaks within the hour.
 */
import { BROWSER_UA } from './companies/shared';
import type { CompanyStdEvent } from './companies/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const URL = 'https://ethglobal.com/events';

/** Balanced-bracket slice of the array that follows `key` in `text` (RSC is unescaped). */
function extractArray(text: string, key: string): string | null {
    const k = text.indexOf(key);
    if (k === -1) return null;
    const start = text.indexOf('[', k);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

export async function fetchEthGlobal(): Promise<unknown[]> {
    let events: any[];
    try {
        const res = await fetch(URL, { headers: { RSC: '1', 'user-agent': BROWSER_UA } });
        if (!res.ok) throw new Error(`ethglobal → ${res.status}`);
        const body = await res.text();
        const raw = extractArray(body, '"events":[');
        if (!raw) throw new Error('events array not found in RSC payload');
        events = JSON.parse(raw);
    } catch (e) {
        console.warn(`ethglobal: ${(e as Error).message}`);
        return [];
    }

    const out: CompanyStdEvent[] = [];
    for (const ev of events) {
        if (ev.type !== 'hackathon' || ev.status !== 'future' || !ev.startTime) continue;
        const online = ev.medium === 'virtual';
        const cc = String(ev.city?.countryCode ?? '').toUpperCase();
        if (!online && cc !== 'US' && cc !== 'CA') continue;

        out.push({
            _std: true,
            _provider: 'ethglobal',
            _company: 'ETHGlobal',
            id: ev.slug,
            title: String(ev.name ?? '').slice(0, 100),
            url: `https://ethglobal.com/events/${ev.slug}`,
            image: '', // banner URLs expire in ~1h — let the card fall back
            online,
            city: online ? 'Online' : ev.city?.name ?? 'Online',
            country: online ? 'Online' : ev.city?.country?.name,
            startISO: ev.startTime,
            endISO: ev.endTime ?? undefined,
            timezone: 'UTC',
            description: '',
            category: 'hackathon',
            isFree: true,
        });
    }
    return out;
}
