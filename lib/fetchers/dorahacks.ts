/**
 * DoraHacks — undocumented but public Django REST API (dorahacks.io/api/hackathon/).
 * Strong AI/agentic + Web3 hackathon fit; the live pool is overwhelmingly virtual,
 * so we keep only `participation_form: 'Virtual'` (online ⇒ attendable from NA; the
 * in-person events are APAC and would be dropped by the geo gate anyway).
 *
 * Operational gotcha: an AWS WAF returns 405 + an HTML challenge on bursts or when
 * Accept is missing. We send Accept: application/json + a browser UA, throttle to
 * ~1 req/s, and treat any non-JSON response as a (skipped) failure rather than data.
 */
import { BROWSER_UA } from './companies/shared';
import type { CompanyStdEvent } from './companies/shared';
import { MAX_HACKATHON_DAYS, MAX_ITEMS } from './config';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = 'https://dorahacks.io/api/hackathon/';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(status: string, page: number): Promise<{ results?: any[]; next?: string | null }> {
    const res = await fetch(`${API}?status=${status}&page=${page}`, {
        headers: { accept: 'application/json', 'user-agent': BROWSER_UA },
    });
    const ct = res.headers.get('content-type') ?? '';
    // WAF challenge: 405 + text/html. Don't parse it as data — fail the page.
    if (!res.ok || !ct.includes('application/json')) {
        throw new Error(`dorahacks ${status} p${page} → ${res.status} (${ct || 'no content-type'})`);
    }
    return res.json();
}

export async function fetchDoraHacks(): Promise<unknown[]> {
    const out: CompanyStdEvent[] = [];

    for (const status of ['upcoming', 'ongoing']) {
        for (let page = 1; page <= 3 && out.length < MAX_ITEMS; page++) {
            let data: { results?: any[]; next?: string | null };
            try {
                data = await fetchPage(status, page);
            } catch (e) {
                console.warn(`dorahacks: ${(e as Error).message}`);
                break; // back off this status; per-source isolation handles the rest
            }

            for (const h of data.results ?? []) {
                if (h.participation_form !== 'Virtual' || !h.start_time) continue;
                if (!h.uname || h.uname === 'null') continue; // no slug → URL would 404
                if (h.end_time && (h.end_time - h.start_time) / 86_400 > MAX_HACKATHON_DAYS) continue;
                out.push({
                    _std: true,
                    _provider: 'dorahacks',
                    _company: h.organization?.name || 'DoraHacks',
                    id: h.uname,
                    title: String(h.title ?? '').slice(0, 100),
                    url: `https://dorahacks.io/hackathon/${h.uname}/`,
                    image: h.image_url ?? '',
                    online: true,
                    city: 'Online',
                    startISO: new Date(h.start_time * 1000).toISOString(),
                    endISO: h.end_time ? new Date(h.end_time * 1000).toISOString() : undefined,
                    timezone: 'UTC',
                    description: typeof h.description === 'string' ? h.description : '',
                    category: 'hackathon',
                    isFree: true,
                });
            }

            if (!data.next) break;
            await sleep(1100); // ~1 req/s to stay under the WAF threshold
        }
    }

    return out;
}
