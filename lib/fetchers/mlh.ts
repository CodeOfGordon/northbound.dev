/**
 * MLH hackathons: the season pages embed the full event list as a JSON array
 * (name, startsAt/endsAt ISO, venueAddress, formatType, websiteUrl, ...) — plain
 * fetch + balanced-bracket extraction, no HTML parser and no Apify.
 */
import { getText } from './util';
import { MLH_PROVINCES, MLH_SEASON_URLS } from './config';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Extract the first complete JSON array starting at `marker` inside `text`. */
function extractJsonArray(text: string, marker: string): any[] {
    const start = text.indexOf(marker);
    if (start === -1) throw new Error(`marker ${marker} not found`);
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++; // skip escaped char
            else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) return JSON.parse(text.slice(start, i + 1));
        }
    }
    throw new Error('unterminated JSON array');
}

export async function fetchMlh(): Promise<unknown[]> {
    const pages = await Promise.all(
        MLH_SEASON_URLS.map(async (url) => {
            try {
                return extractJsonArray(await getText(url), '[{"id":"');
            } catch (e) {
                console.warn(`mlh: ${url} skipped — ${(e as Error).message}`);
                return [];
            }
        }),
    );

    const now = Date.now();
    const seen = new Set<string>();
    return pages.flat().filter((ev: any) => {
        if (!ev?.id || !ev.name || !ev.startsAt) return false;
        if (seen.has(ev.id)) return false;
        seen.add(ev.id);
        if (ev.status === 'ended' || new Date(ev.endsAt ?? ev.startsAt).getTime() < now) return false;
        // Any digital hackathon; in person: all of the US (travel-reimbursement
        // coverage — see ADR-019), Canada narrowed to Ontario/Quebec (home regions).
        if (ev.formatType === 'digital') return true;
        if (ev.venueAddress?.country === 'US') return true;
        return ev.venueAddress?.country === 'CA' && MLH_PROVINCES.has(ev.venueAddress?.state ?? '');
    });
}
