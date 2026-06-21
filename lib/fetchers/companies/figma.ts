/**
 * Figma webinars/office hours from the events-and-webinars marketing page.
 * The list is server-rendered as Next.js RSC flight chunks (self.__next_f.push):
 * unescape + concatenate them, then take the first "eventListLego" block with an
 * INLINE events array (later occurrences are "$..." path refs to the same data).
 * Items are Sanity documents: portable-text description, times[] of UTC instants
 * with a duration in minutes — one CompanyStdEvent per times entry. The list has
 * no tags, so a keyword filter keeps only developer-facing sessions. Figma's
 * robots.txt blocks AI-crawler UA tokens — fetch with a neutral browser UA.
 * Verified live 2026-06-10.
 */
import { MAX_ITEMS } from '../config';
import { BROWSER_UA, type CompanyStdEvent } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE = 'https://www.figma.com/events-and-webinars/';

const DEV_RE = /dev mode|mcp|code connect|api|github|cli|plugin|widget|developer|code|figma make/i;

/** Extract the first complete JSON value ('[' or '{') starting at `start`. */
function extractJson(text: string, start: number): any {
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
    throw new Error('unterminated JSON value');
}

/** Sanity portable text → plain text (blocks[].children[].text joined). */
function portableText(blocks: any): string | undefined {
    if (typeof blocks === 'string') return blocks;
    if (!Array.isArray(blocks)) return undefined;
    const text = blocks
        .map((b: any) => (b?.children ?? []).map((c: any) => c?.text ?? '').join(''))
        .join('\n')
        .trim();
    return text || undefined;
}

export async function fetchFigma(src: { company: string }): Promise<CompanyStdEvent[]> {
    const res = await fetch(PAGE, { headers: { 'user-agent': BROWSER_UA } });
    if (!res.ok) throw new Error(`GET ${PAGE} → ${res.status}`);
    const html = await res.text();

    // Reassemble the RSC flight stream: each chunk is a JS-escaped string literal.
    const chunkRe = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    const chunks: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = chunkRe.exec(html)) !== null) {
        try {
            chunks.push(JSON.parse(`"${m[1]}"`));
        } catch {
            // undecodable chunk — not part of the JSON payload we need
        }
    }
    const flight = chunks.join('');

    let events: any[] | null = null;
    let occ = -1;
    while ((occ = flight.indexOf('"eventListLego"', occ + 1)) !== -1) {
        const key = flight.indexOf('"events":', occ);
        if (key === -1 || flight[key + 9] !== '[') continue;
        events = extractJson(flight, key + 9);
        break;
    }
    if (!events) throw new Error('no inline eventListLego events array — page layout changed?');

    const now = Date.now();
    const out: CompanyStdEvent[] = [];
    for (const ev of events) {
        if (!ev?._key || !ev.title || !Array.isArray(ev.times)) continue;
        const description = portableText(ev.description);
        if (!DEV_RE.test(`${ev.title} ${description ?? ''}`)) continue;
        ev.times.forEach((t: any, i: number) => {
            const start = Date.parse(t?.time ?? '');
            const url = t?.action?.target;
            if (Number.isNaN(start) || start < now) return;
            if (typeof url !== 'string' || !url.startsWith('http')) return;
            out.push({
                _std: true,
                _provider: 'figma',
                _company: src.company,
                id: `${ev._key}:${i}`,
                title: ev.title,
                url,
                description,
                city: 'Online',
                online: true,
                startISO: t.time,
                endISO: typeof t.duration === 'number'
                    ? new Date(start + t.duration * 60_000).toISOString()
                    : undefined,
                timezone: 'UTC',
            });
        });
    }
    return out.slice(0, MAX_ITEMS);
}
