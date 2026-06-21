---
name: calendar-button
description: Use when adding the Add to Calendar button (Google/Outlook/Apple/iCal) to a React component. Covers add-to-calendar-button-react, the Next.js App Router use-client wrapper, timeZone/startTime formats, and SSR gotchas.
---

# Add to Calendar button (Northbound)

Adds an "Add to Calendar" control to an event card so users can drop a scraped event into
Google / Outlook / Apple / Yahoo / iCal with no backend and no OAuth. Built on
`add-to-calendar-button-react` inside a `'use client'` wrapper, with a hand-built
`.ics` + Google URL fallback for zero-dependency cases.

## Where this plugs in

- `components/EventCard.tsx` — the card (already `'use client'`, already imports `posthog` and
  calls `posthog.capture('event_card_clicked', {...})`). The card wraps everything in a
  `<Link>`, so the calendar button must NOT bubble its click up to that link.
- `components/ExploreBtn.tsx` — reference for the project's posthog usage pattern.
- New file: `components/AddToCalendarBtn.tsx` — the client-only wrapper described below.
- Optional: `utils/calendar.ts` — the dependency-free fallback (Google URL + `.ics`).

## Field mapping (PROJECT CANON — exact Event field names)

The Event model (`database/event.model.ts`) stores normalized strings. Map them straight to props:

| Event field        | Calendar prop | Format / note                                             |
| ------------------ | ------------- | --------------------------------------------------------- |
| `Event.date`       | `startDate`   | `YYYY-MM-DD` (already normalized by the pre-save hook)    |
| `Event.time`       | `startTime`   | `HH:MM` 24h (already normalized). Omit -> all-day event   |
| `Event.timezone`   | `timeZone`    | IANA, default `America/Toronto` (schema extension)        |
| `Event.title`      | `name`        | required                                                  |
| `Event.description`| `description` | supports `[br]` and `[url]https://..\|label[/url]` markup |
| `Event.venue` (+ `city`, `country`) | `location` | free text; build `venue, city, country`     |
| `Event.endDate`    | `endDate`     | optional schema field; omit -> defaults to `startDate`    |
| `Event.endTime`    | `endTime`     | optional; see "no end time" below                         |

There is NO `startTime`/`endTime`/`location`/`timeZone` field on the Event model — those are
calendar PROPS we derive. Do not invent Event fields; the canonical ones are
`title, slug, description, overview, image, venue, country, city, date, time, mode, audience,
agenda, organizer, tags` plus the extensions `url, source, sourceId, fingerprint, timezone,
endDate, endTime, isFree, price, category/eventType`.

### endTime rule (load-bearing)

A timed event needs BOTH `startTime` and `endTime` — the library has no "open-ended timed event".
When the scraped end time is unknown, pick ONE:

1. **Omit both `startTime` and `endTime`** -> the library renders an all-day event (no `timeZone`
   needed). Safest when only `Event.date` is known.
2. **Default `endTime` to start + 1h** when you have `Event.time` but no end. Compute it upstream
   (deterministically), never from `new Date()` at render.

## The package

`add-to-calendar-button-react` (v2.x; peer deps `react >=18`, works on React 19). Named export,
NOT default. The core is a Web Component, which is the source of the SSR caveats below.

```bash
npm install add-to-calendar-button-react
```

```tsx
import { AddToCalendarButton } from 'add-to-calendar-button-react';
```

`options` accepts a real array (the React wrapper, unlike the raw web component, takes arrays not
strings). Valid values: `'Apple' | 'Google' | 'iCal' | 'Microsoft365' | 'MicrosoftTeams' |
'Outlook.com' | 'Yahoo'`. For this product use:
`options={['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo']}`.

## SSR / hydration gotcha (App Router)

The component registers a custom element and touches `window`/`document` on mount, so it must
never run during SSR — rendering it server-side produces markup React's client pass won't match
("Hydration failed"). A plain `'use client'` is often not enough; the robust cure is a dynamic
import with `ssr: false`.

> This repo runs a **modified Next.js 16** (`AGENTS.md`). `next/dynamic` with `{ ssr: false }` is
> exactly the kind of API that may differ — confirm against the bundled docs at
> `node_modules/next/dist/docs/01-app` (Server and Client Components, dynamic import) before
> shipping. `ssr: false` is only allowed inside a Client Component, so the wrapper file MUST start
> with `'use client'`.

### components/AddToCalendarBtn.tsx (copy-paste)

```tsx
'use client';

import dynamic from 'next/dynamic';
import posthog from 'posthog-js';

// ssr:false skips the server render entirely -> no hydration mismatch.
// Allowed here only because this file is a Client Component ('use client' above).
const AddToCalendarButton = dynamic(
  () => import('add-to-calendar-button-react').then((m) => m.AddToCalendarButton),
  { ssr: false }
);

interface Props {
  title: string;
  description?: string;
  date: string;          // Event.date   -> YYYY-MM-DD
  time?: string;         // Event.time   -> HH:MM (omit -> all-day)
  endTime?: string;      // Event.endTime (optional)
  timezone?: string;     // Event.timezone (IANA), default America/Toronto
  venue?: string;
  city?: string;
  country?: string;
  slug: string;          // for analytics + uid
}

const AddToCalendarBtn = ({
  title,
  description,
  date,
  time,
  endTime,
  timezone = 'America/Toronto',
  venue,
  city,
  country,
  slug,
}: Props) => {
  const location = [venue, city, country].filter(Boolean).join(', ');

  // Build only the props we actually have; omit times together for all-day.
  const timed = Boolean(time);
  const calProps = {
    name: title,
    options: ['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo'] as const,
    startDate: date,
    location,
    description: description ?? '',
    status: 'CONFIRMED' as const,
    lightMode: 'system' as const,
    ...(timed
      ? {
          startTime: time,
          // end unknown -> default to start + 1h (computed deterministically)
          endTime: endTime ?? addOneHour(time!),
          timeZone: timezone,
        }
      : {}),
  };

  // Stop the click from bubbling to the parent <Link> in EventCard.
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        posthog.capture('add_to_calendar_clicked', {
          slug,
          title,
          city,
          country,
          date,
          time: time ?? null,
          timezone,
        });
      }}
    >
      <AddToCalendarButton {...calProps} />
    </span>
  );
};

// "HH:MM" -> "HH:MM" one hour later (24h, wraps at midnight). Pure + deterministic.
function addOneHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const nh = (h + 1) % 24;
  return `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default AddToCalendarBtn;
```

## Wiring it into EventCard.tsx

`EventCard` is already a `'use client'` component whose whole body is a `<Link href='/events/...'>`.
Render the button INSIDE the card but rely on the wrapper's `stopPropagation`/`preventDefault`
(above) so clicking the calendar button does not navigate. Pass the canonical Event fields straight
through:

```tsx
import AddToCalendarBtn from '@/components/AddToCalendarBtn';

// ...inside the card, e.g. after the .datetime block:
<AddToCalendarBtn
  title={title}
  date={date}
  time={time}
  // timezone/venue/endTime come from the Event doc once those props are threaded
  city={city}
  country={country}
  slug={slug}
/>
```

`EventCard`'s current `Props` only carry `title, image, slug, organization, country, city, date,
time`. To pass `timezone`/`venue`/`description`/`endTime` you must add them to `Props` and feed
them from the page that renders the card (those values come from the Event document).

## Analytics

posthog is already wired (`instrumentation-client.ts`, default import `posthog` from `posthog-js`,
called as `posthog.capture(...)` — see `EventCard.tsx`/`ExploreBtn.tsx`). Existing event names:
`explore_events_clicked`, `event_card_clicked`. Add a NEW name for this feature; do not rename the
existing ones:

```ts
posthog.capture('add_to_calendar_clicked', { slug, title, city, country, date, time, timezone });
```

The capture lives in the wrapper's `onClick` (above), which also stops the click reaching the card's
`event_card_clicked` link — the two events stay distinct.

## Zero-dependency fallback (Google URL + hand-built .ics)

Use this if you want no library / full control. `buildICS` and `googleCalendarUrl` are pure and
SSR-safe; only `downloadICS` (uses `document` + `crypto.randomUUID`) must run client-side. Times
are emitted in **UTC basic format** `YYYYMMDDTHHMMSSZ` — distinct from the library's `HH:MM` prop.

```ts
// utils/calendar.ts
type CalEvent = {
  title: string;
  description?: string;
  location?: string;
  start: Date;      // UTC-aware Date
  end?: Date;       // omit -> start + 1h
  allDay?: boolean;
};

function toICSDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function toDateOnly(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
function resolveEnd(e: CalEvent) {
  return e.end ?? new Date(e.start.getTime() + 60 * 60 * 1000);
}

export function googleCalendarUrl(e: CalEvent) {
  const end = resolveEnd(e);
  const dates = e.allDay
    ? `${toDateOnly(e.start)}/${toDateOnly(new Date(end.getTime() + 86400000))}` // end-exclusive
    : `${toICSDate(e.start)}/${toICSDate(end)}`;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates,
    details: e.description ?? '',
    location: e.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function buildICS(e: CalEvent) {
  const end = resolveEnd(e);
  const esc = (s = '') =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const dtStart = e.allDay
    ? `DTSTART;VALUE=DATE:${toDateOnly(e.start)}`
    : `DTSTART:${toICSDate(e.start)}`;
  const dtEnd = e.allDay
    ? `DTEND;VALUE=DATE:${toDateOnly(new Date(end.getTime() + 86400000))}`
    : `DTEND:${toICSDate(end)}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//events_site//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@events_site`,
    `DTSTAMP:${toICSDate(new Date())}`,
    dtStart,
    dtEnd,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc(e.description)}`,
    `LOCATION:${esc(e.location)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'); // RFC 5545 requires CRLF
}

export function downloadICS(e: CalEvent, filename = 'event.ics') {
  const blob = new Blob([buildICS(e)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Fallback notes:
- Google: `action=TEMPLATE`, `dates=START/END` (slash-separated, UTC basic). All-day uses date-only
  with an end-exclusive (+1 day) `DTEND`.
- Apple / Outlook desktop have no URL scheme — use the `.ics` blob download (works for native
  clients). Outlook.com / Office365 web have their own deep-link compose URLs with ISO
  `startdt`/`enddt` if you want web targets without `.ics`.
- To turn `Event.date` (`YYYY-MM-DD`) + `Event.time` (`HH:MM`) + `Event.timezone` (IANA) into the
  `start: Date`, convert once upstream (e.g. with a tz library) — do NOT parse with `new Date(str)`
  at render time, since server vs. client clocks/zones differ.

## Checklist

1. `npm install add-to-calendar-button-react`.
2. Add `components/AddToCalendarBtn.tsx` (`'use client'` + `dynamic(..., { ssr:false })`).
3. Map `Event.date->startDate`, `Event.time->startTime`, `Event.timezone->timeZone`,
   `title/description`, `venue,city,country->location`. Omit times together when end is unknown
   (all-day) or default `endTime` to start + 1h.
4. Render inside `EventCard.tsx`; the wrapper `stopPropagation()`s so it doesn't trigger the card's
   `<Link>` / `event_card_clicked`.
5. `posthog.capture('add_to_calendar_clicked', {...})` in the wrapper's `onClick`.
6. Verify dynamic-import / Client Component behavior against `node_modules/next/dist/docs/01-app`
   (modified Next.js 16).
