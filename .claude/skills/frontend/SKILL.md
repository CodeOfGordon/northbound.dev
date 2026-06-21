---
name: frontend
description: Use when building the Next.js 16 UI - the event grid, filter bar, search box, and event card - including URL-based filter state with searchParams and server-vs-client data fetching.
---

# Frontend: event grid, filter bar, search, cards

Builds the Northbound browse UI on Next.js 16 (App Router). Source of truth for any
Next.js API is the bundled docs at `node_modules/next/dist/docs/01-app` — this is a
**modified Next.js 16.2.6**, so verify before trusting memory. Database is **MongoDB +
Mongoose** (see the `database/` skill); never assume Supabase/Postgres.

Real files you will touch or mirror:
- `app/page.tsx` — landing page; renders `events` from `lib/constants.ts` into `<ul className="events">`.
- `app/layout.tsx` — root layout, fonts, `<Navbar/>`, `LightRays` background, `<main>`.
- `components/EventCard.tsx` — `'use client'` card (PostHog `event_card_clicked`).
- `components/Navbar.tsx`, `components/ExploreBtn.tsx` (`explore_events_clicked`).
- `lib/utils.ts` — `cn()` (clsx + tailwind-merge). Styling is **Tailwind v4** + shadcn/radix.

## Architecture: server shell, client controls

The browse route is a **server component** that reads `searchParams`, fetches matching
events (DB or API), and renders the grid. The filter bar and search box are **client
components** that only mutate the URL — they never hold the event list in state. The URL
is the single source of filter truth: shareable, back-button-correct, SSR-friendly.

```
app/events/page.tsx        (server) reads searchParams -> fetches -> <EventGrid>
  components/FilterBar.tsx  (client) writes ?mode=&city=&tag= to the URL
  components/SearchBox.tsx  (client) writes ?q= (debounced) to the URL
  components/EventGrid.tsx  (server) maps events -> <EventCard>
  components/EventCard.tsx  (client) renders one card + calendar button
app/events/loading.tsx     skeleton shown while the server component awaits data
```

## Canonical Event shape (align EXACTLY — from `database/event.model.ts`)

Fields: `title` `slug` `description` `overview` `image` `venue` `country` `city`
`date` (String `YYYY-MM-DD`) `time` (String `HH:MM` 24h) `mode` (`online|offline|hybrid`)
`audience` `agenda: string[]` `organizer` `tags: string[]` + `createdAt/updatedAt`.
Aggregator additions: `url` (REQUIRED canonical link), `source`, `timezone` (IANA, default
`America/Toronto`), optional `endDate/endTime`, `isFree/price`, `category/eventType`.

> The card prop names in the current `components/EventCard.tsx` (`organization`) do **not**
> match the model (`organizer`). When wiring real data, rename to `organizer` and add
> `url`. Also note a real bug there: `href='/events/${slug}'` uses single quotes, so the
> template literal is NOT interpolated — fix to backticks: `` href={`/events/${slug}`} ``.

## Reading filters: `searchParams` is async in v16

`searchParams` is a **Promise** and MUST be awaited (the v15 sync shim is removed). Using
it opts the page into dynamic rendering. It's a plain object, not `URLSearchParams`.

```tsx
// app/events/page.tsx  (Server Component)
import EventGrid from '@/components/EventGrid';
import FilterBar from '@/components/FilterBar';
import SearchBox from '@/components/SearchBox';
import { getEvents } from '@/lib/events';

export default async function EventsPage({
  searchParams,
}: PageProps<'/events'>) {        // PageProps is globally available after typegen
  const sp = await searchParams;   // { mode?: string; city?: string; tag?: string|string[]; q?: string }

  const events = await getEvents({
    mode: typeof sp.mode === 'string' ? sp.mode : undefined,
    city: typeof sp.city === 'string' ? sp.city : undefined,
    tags: sp.tag ? (Array.isArray(sp.tag) ? sp.tag : [sp.tag]) : undefined,
    q: typeof sp.q === 'string' ? sp.q : undefined,
  });

  return (
    <section>
      <h1 className="text-center">Browse Tech Events</h1>
      <div className="mt-7 flex flex-col gap-4">
        <SearchBox />
        <FilterBar />
      </div>
      <EventGrid events={events} />
    </section>
  );
}
```

## Server data fetching: DB direct vs API vs client SWR

Default to fetching **directly from MongoDB in the server component** — fewer hops, no
extra route, type-safe. Use `.lean()` for POJOs. Mongoose needs the Node runtime.

```ts
// lib/events.ts
import 'server-only';
import connectDB from '@/database/mongodb';
import { Event, type IEvent } from '@/database';
import type { FilterQuery } from 'mongoose';

export type EventFilters = { mode?: string; city?: string; tags?: string[]; q?: string };

export async function getEvents(f: EventFilters): Promise<IEvent[]> {
  await connectDB();                      // first awaited line — bufferCommands is off
  const filter: FilterQuery<IEvent> = {};
  if (f.mode && ['online', 'offline', 'hybrid'].includes(f.mode)) filter.mode = f.mode;
  if (f.city) filter.city = { $regex: `^${f.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
  if (f.tags?.length) filter.tags = { $in: f.tags };
  if (f.q) filter.$text = { $search: f.q };           // requires the text index (database skill)
  filter.date = { $gte: new Date().toISOString().slice(0, 10) }; // upcoming only; YYYY-MM-DD lexical == chronological
  return Event.find(filter).sort({ date: 1, _id: 1 }).limit(60).lean<IEvent[]>();
}
```

```ts
// app/events/page.tsx must run on Node, not Edge, since it touches Mongoose transitively.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // reads are per-request; do not statically cache
```

Reach for the **API route** (`app/api/events/route.ts`) instead of a direct DB call when
the client needs to re-fetch without a full navigation (infinite scroll, live typeahead).
Then a client island can use SWR/`fetch`. In v16 `fetch` is **not cached by default**:

```tsx
'use client';
import useSWR from 'swr';
const fetcher = (u: string) => fetch(u).then((r) => r.json());

export function LiveResults({ query }: { query: string }) {
  const { data, isLoading } = useSWR(`/api/events?q=${encodeURIComponent(query)}`, fetcher);
  if (isLoading) return <GridSkeleton />;
  return <EventGrid events={data?.items ?? []} />;
}
```

Rule of thumb: **server component + direct DB for the first paint** (SEO, no spinner);
**client SWR against `/api/events` only for post-load interactivity**. Don't fetch the
same list both ways.

## Filter bar & search box: write the URL, don't hold state

Client controls read current values from `useSearchParams()` and push updates with
`router.replace` so filtering doesn't spam history. Use `usePathname()` to stay on route.

```tsx
// components/FilterBar.tsx
'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const MODES = ['online', 'offline', 'hybrid'] as const;

export default function FilterBar() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  function setParam(key: string, value?: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const active = sp.get('mode');
  return (
    <div className="flex gap-2">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setParam('mode', active === m ? undefined : m)}
          className={cn('rounded-full border px-3 py-1 text-sm',
            active === m && 'bg-white text-black')}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
```

```tsx
// components/SearchBox.tsx — debounced ?q=
'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SearchBox() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState(sp.get('q') ?? '');

  useEffect(() => {
    const id = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      q ? params.set('q', q) : params.delete('q');
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search events…"
      className="w-full rounded-md border bg-transparent px-3 py-2"
    />
  );
}
```

Updating `searchParams` re-runs the server `EventsPage` with new data — no client list
state to keep in sync. Pass `{ scroll: false }` so the grid doesn't jump on every keystroke.

## Grid, card, loading, empty states

```tsx
// components/EventGrid.tsx  (Server Component)
import EventCard from '@/components/EventCard';
import type { IEvent } from '@/database';

export default function EventGrid({ events }: { events: IEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-10 text-center text-gray-400">No events match your filters yet.</p>;
  }
  return (
    <ul className="events mt-10">          {/* reuse the existing .events grid class from globals.css */}
      {events.map((e) => (
        <li key={e.slug}>
          <EventCard {...e} />
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// app/events/loading.tsx — streamed automatically while the page awaits getEvents()
export default function Loading() {
  return (
    <ul className="events mt-10">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="h-72 animate-pulse rounded-xl bg-white/5" />
      ))}
    </ul>
  );
}
```

`loading.tsx` wraps the route in a Suspense boundary for free — no manual `<Suspense>`
needed for the page-level fallback.

## Calendar button mounts inside the card

The "Add to calendar" control lives on each `EventCard` (or the event detail page). It is
a **client-only** wrapper around `add-to-calendar-button-react` — see the
**calendar-button** skill for the full component, SSR (`ssr:false`) handling, and the
`Event.date -> startDate`, `Event.time -> startTime`, `Event.timezone -> timeZone` mapping.
Render it after the card's link content so a card click still routes to the detail page.

## Analytics

Keep existing PostHog event names: `explore_events_clicked` (ExploreBtn) and
`event_card_clicked` (EventCard). Add `capture()` calls for new actions (e.g.
`filter_applied`, `search_submitted`) as those features land — don't rename the existing two.

## Gotchas
- `searchParams`/`params` are Promises in v16 — always `await` (or `use()` in client pages).
- `fetch` and GET route handlers are **not cached by default** here; opt in explicitly.
- Any server code that imports `database/*` must run on `runtime = 'nodejs'`.
- Fix the `EventCard` href bug (backticks) and align `organization` -> `organizer` + add `url`.
- Filter/search components must be `'use client'` (they use `next/navigation` hooks).
