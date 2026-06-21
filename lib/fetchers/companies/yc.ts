/**
 * Y Combinator events (events.ycombinator.com) — Rails + Inertia.js pages that
 * embed the full event as HTML-escaped JSON in a data-page attribute. There is
 * no public index: slugs come from the official Work at a Startup listing
 * (workatastartup.com/events, props.eventsUpcoming) unioned with a curated
 * slug list in the registry config. Verified live 2026-06-10.
 */
import { MAX_ITEMS } from '../config';
import { BROWSER_UA, CompanyStdEvent } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const EVENTS_BASE = 'https://events.ycombinator.com';
const DISCOVERY_URL = 'https://www.workatastartup.com/events';

/**
 * Rails attribute-escapes the JSON (&quot; &amp; &lt; &gt; &#39;) — decode
 * numeric/named entities with &amp; last so double-escapes survive.
 */
function decodeEntities(s: string): string {
    return s
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/** Fetch an Inertia page and return the decoded data-page props object. */
async function getPageProps(url: string): Promise<any> {
    const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA } });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    const match = (await res.text()).match(/data-page="([^"]*)"/);
    if (!match) throw new Error(`no data-page attribute at ${url}`);
    return JSON.parse(decodeEntities(match[1]))?.props;
}

export async function fetchYc(src: { company: string; slugs: string[] }): Promise<CompanyStdEvent[]> {
    const slugs = new Set(src.slugs ?? []);

    // Discovery is best-effort: the curated slug list still works without it.
    try {
        const props = await getPageProps(DISCOVERY_URL);
        for (const item of props?.eventsUpcoming ?? []) {
            const m = String(item?.eventUrl ?? '').match(/events\.ycombinator\.com\/([\w-]+)/);
            if (m) slugs.add(m[1]);
        }
    } catch (e) {
        console.warn(`yc: discovery page skipped — ${(e as Error).message}`);
    }

    const now = Date.now();
    const events = await Promise.all(
        [...slugs].map(async (slug): Promise<CompanyStdEvent | null> => {
            try {
                const meetup = (await getPageProps(`${EVENTS_BASE}/${slug}`))?.meetup;
                if (!meetup?.title || !meetup.starts_at || meetup.cancelled) return null;
                if (new Date(meetup.ends_at ?? meetup.starts_at).getTime() < now) return null;
                const online = meetup.join_event_url != null;
                return {
                    _std: true,
                    _provider: 'yc',
                    _company: src.company,
                    id: String(meetup.id ?? slug),
                    title: meetup.title,
                    url: `${EVENTS_BASE}/${meetup.slug ?? slug}`,
                    description: meetup.description || undefined,
                    image: meetup.cover_img_url || undefined,
                    city: meetup.public_location || (online ? 'Online' : undefined),
                    online,
                    startISO: meetup.starts_at,
                    endISO: meetup.ends_at || undefined,
                    timezone: meetup.time_zone || undefined,
                };
            } catch (e) {
                console.warn(`yc: slug "${slug}" skipped — ${(e as Error).message}`);
                return null;
            }
        }),
    );

    return events.filter((ev): ev is CompanyStdEvent => ev !== null).slice(0, MAX_ITEMS);
}
