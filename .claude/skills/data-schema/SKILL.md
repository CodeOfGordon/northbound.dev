---
name: data-schema
description: Use when defining or extending the canonical Event type, or writing normalization functions that map raw scraped data into the Mongoose Event model. Covers required fields, source/url/fingerprint extensions, and date/time/timezone normalization.
---

# Data Schema: the canonical Event

The single source of truth for an event is the **Mongoose `Event` model** in
`database/event.model.ts`. Everything in the aggregator — scrapers, API routes, the
calendar-export button — maps to or from this one shape. This skill covers the
canonical fields, the aggregator extensions to add, and `normalizeRawEvent(raw, source)`.

Database is **MongoDB + Mongoose** (final). Read these real files before editing:

- `database/event.model.ts` — the `Event` model + `IEvent` + pre-save hooks.
- `database/booking.model.ts` — `Booking` (one per email per event).
- `database/index.ts` — barrel: `Event`, `Booking`, `IEvent`, `IBooking`.

Related skills: deduplication (the `fingerprint` algorithm) and database
(connection, upsert/bulkWrite, indexes). This skill owns the *field shapes*; those own
*how rows get written*.

## Canonical Event fields (EXACT — do not rename)

From `database/event.model.ts`, `IEvent` is:

| Field | Type | Rules |
|---|---|---|
| `title` | string | required, trim, max 100 |
| `slug` | string | unique, lowercase, **auto-generated from `title`** in a `pre('save')` hook |
| `description` | string | required, trim, max 1000 |
| `overview` | string | required, trim, max 500 |
| `image` | string | required, trim |
| `venue` | string | required, trim |
| `country` | string | required, trim |
| `city` | string | required, trim |
| `date` | string | required, **normalized to `YYYY-MM-DD`** in pre-save |
| `time` | string | required, **normalized to `HH:MM` 24h** in pre-save |
| `mode` | string | required, enum `online \| offline \| hybrid` |
| `audience` | string | required, trim |
| `agenda` | string[] | required, at least one item |
| `organizer` | string | required, trim |
| `tags` | string[] | required, at least one item |
| `createdAt` / `updatedAt` | Date | from `{ timestamps: true }` |

Indexes today: `{ slug: 1 }` unique; `{ date: 1, mode: 1 }`.

> The pre-save hook normalizes `date`/`time` and builds `slug` — but it runs **only on
> `.save()`/`.create()`, NOT on `updateOne`/`bulkWrite`**. The scraper upserts with
> bulk ops, so it must normalize *before* writing (that is what `normalizeRawEvent` is for).

## Aggregator extensions (propose as a diff, do not silently rewrite the file)

The scraped-feed product needs more than the hand-entered shape. Add these fields and
**relax the requireds that scraped sources can't always supply** — `overview`, `agenda`,
and `audience` are frequently absent on Luma/Eventbrite/Meetup pages, so a hard `required`
would reject perfectly good events.

```diff
 export interface IEvent extends Document {
     title: string;
     slug: string;
     description: string;
-    overview: string;
+    overview?: string;            // often missing on scraped sources
     image: string;
     venue: string;
     country: string;
     city: string;
     date: string;                 // YYYY-MM-DD
     time: string;                 // HH:MM (24h)
+    endDate?: string;             // YYYY-MM-DD, optional
+    endTime?: string;             // HH:MM (24h), optional
+    timezone: string;             // IANA, e.g. America/Toronto — needed for calendar export
     mode: string;                 // online | offline | hybrid
-    audience: string;
+    audience?: string;            // often missing on scraped sources
-    agenda: string[];
+    agenda?: string[];            // often missing on scraped sources
     organizer: string;
     tags: string[];
+    url: string;                  // canonical link to the source event page — REQUIRED for this product
+    source: 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';
+    sourceId?: string;            // platform-native id, when available
+    fingerprint: string;         // dedup key (see deduplication skill)
+    isFree?: boolean;             // free vs paid filter
+    price?: string;               // display price, e.g. "$25" or "Free"
+    category?: 'hackathon' | 'meetup' | 'conference' | 'networking';
     createdAt: Date;
     updatedAt: Date;
 }
```

And the schema fields (note the relaxed requireds — drop the `agenda` `validate` that
demands a non-empty array, since scraped events may have none):

```diff
     overview: {
         type: String,
-        required: [true, 'Overview is required'],
         trim: true,
         maxlength: [500, 'Overview cannot exceed 500 characters'],
     },
@@
     audience: {
         type: String,
-        required: [true, 'Audience is required'],
         trim: true,
     },
     agenda: {
         type: [String],
-        required: [true, 'Agenda is required'],
-        validate: {
-            validator: (v: string[]) => v.length > 0,
-            message: 'At least one agenda item is required',
-        },
+        default: [],
     },
     tags: {
         type: [String],
         required: [true, 'Tags are required'],
         validate: {
             validator: (v: string[]) => v.length > 0,
             message: 'At least one tag is required',
         },
     },
+    endDate:  { type: String },
+    endTime:  { type: String },
+    timezone: { type: String, default: 'America/Toronto' },
+    url:      { type: String, required: [true, 'Source URL is required'], trim: true },
+    source:   { type: String, enum: ['luma','eventbrite','meetup','mlh','company'], required: true },
+    sourceId: { type: String, trim: true },
+    fingerprint: { type: String, required: true },
+    isFree:   { type: Boolean },
+    price:    { type: String, trim: true },
+    category: { type: String, enum: ['hackathon','meetup','conference','networking'] },
 },
```

Add the indexes the dedup + filter paths need (the deduplication and database skills
cover the rest):

```ts
// dedup key — unique + sparse so legacy hand-entered rows without one don't collide
EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });
// keep tags filterable alongside date ordering
EventSchema.index({ tags: 1, date: 1 });
```

> Why `sparse`: the unique constraint then only applies to documents that *have* a
> `fingerprint`. Hand-entered events created before this migration won't have one and
> must not all collide on `null`.

## `normalizeRawEvent(raw, source)`

One function turns any source's raw shape into a canonical Event payload ready for
`updateOne`/`bulkWrite`. It does NOT compute `slug` or `fingerprint` — `slug` you derive
where you upsert, `fingerprint` comes from the deduplication skill. It DOES normalize
`date`→`YYYY-MM-DD`, `time`→`HH:MM`, and default `timezone` to `America/Toronto`.

Put this in `database/normalize.ts` (or `lib/normalize.ts`). The helpers mirror the
pre-save logic in `event.model.ts` so bulk-written docs match `.save()`-written ones.

```ts
// database/normalize.ts
import type { Document } from 'mongoose';
import type { IEvent } from '@/database';

type Source = 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';

const DEFAULT_TZ = 'America/Toronto';
const DEFAULT_COUNTRY = 'Canada';
const DEFAULT_CITY = 'Toronto';

/** YYYY-MM-DD. Accepts ISO strings, Date-parseable strings, or already-normalized dates. */
export function normalizeDate(input: string | Date): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${String(input)}`);
  return d.toISOString().split('T')[0];
}

/** HH:MM 24h. Accepts "14:30", "2:30 PM", or an ISO timestamp. */
export function normalizeTime(input: string | Date): string {
  if (input instanceof Date) {
    return `${String(input.getUTCHours()).padStart(2, '0')}:${String(input.getUTCMinutes()).padStart(2, '0')}`;
  }
  const m = input.trim().match(/^(\d{1,2}):(\d{2})(\s*(AM|PM))?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2];
    const period = m[4]?.toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  const d = new Date(input); // ISO timestamp fallback
  if (isNaN(d.getTime())) throw new Error(`Invalid time: ${input}`);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function inferMode(venue?: string, isOnline?: boolean): IEvent['mode'] {
  if (isOnline) return 'online';
  return venue && venue.trim() ? 'offline' : 'online';
}

/** Canonical payload — everything except slug + fingerprint (added at upsert time). */
export type CanonicalEvent = Omit<
  IEvent,
  keyof Document | 'slug' | 'fingerprint' | 'createdAt' | 'updatedAt'
>;

/**
 * Map a source-specific raw object to the canonical Event shape.
 * `raw` is the source's native item; one switch arm per source.
 */
export function normalizeRawEvent(raw: any, source: Source): CanonicalEvent {
  switch (source) {
    case 'luma': {
      // mhamas/luma-calendar-events-scraper item: { name, date, timeUTC, timeLocal, city, url, text, slug }
      return {
        title: raw.name,
        description: (raw.text ?? '').slice(0, 1000),
        image: raw.coverUrl ?? '',
        venue: raw.geoAddressInfo?.fullAddress ?? '',
        country: raw.country ?? DEFAULT_COUNTRY,
        city: raw.city ?? DEFAULT_CITY,
        date: normalizeDate(raw.date ?? raw.timeUTC),
        time: normalizeTime(raw.timeLocal ?? raw.timeUTC),
        timezone: raw.timezone ?? DEFAULT_TZ,
        mode: inferMode(raw.geoAddressInfo?.fullAddress), // city-page Luma events default to offline
        organizer: raw.hosts?.[0]?.name ?? 'Luma',
        tags: ['tech'],
        url: raw.url,
        source,
        sourceId: raw.slug,
        isFree: raw.isFree,
      };
    }

    case 'eventbrite': {
      // parseforge/eventbrite-scraper item: { title, startDate, endDate, venueName, address, isOnline, priceRange, organizerName, category, tags, eventUrl, imageUrl }
      return {
        title: raw.title,
        description: (raw.description ?? '').slice(0, 1000),
        image: raw.imageUrl ?? '',
        venue: raw.venueName ?? raw.address ?? '',
        country: raw.country ?? DEFAULT_COUNTRY,
        city: raw.city ?? DEFAULT_CITY,
        date: normalizeDate(raw.startDate),
        time: normalizeTime(raw.startDate),
        endDate: raw.endDate ? normalizeDate(raw.endDate) : undefined,
        endTime: raw.endDate ? normalizeTime(raw.endDate) : undefined,
        timezone: raw.timezone ?? DEFAULT_TZ,
        mode: inferMode(raw.venueName, raw.isOnline),
        organizer: raw.organizerName ?? 'Eventbrite',
        tags: raw.tags?.length ? raw.tags : ['tech'],
        url: raw.eventUrl,
        source,
        sourceId: raw.id,
        isFree: raw.priceRange ? /free/i.test(raw.priceRange) : undefined,
        price: raw.priceRange,
        category: mapCategory(raw.format),
      };
    }

    case 'meetup': {
      // easyapi/meetup-events-scraper item: { title, eventUrl, type, description, dateTime, venue, group, feeSettings, featuredEventPhoto }
      return {
        title: raw.title,
        description: (raw.description ?? '').slice(0, 1000),
        image: raw.featuredEventPhoto?.source ?? '',
        venue: raw.venue?.name ?? '',
        country: raw.venue?.country ?? DEFAULT_COUNTRY,
        city: raw.venue?.city ?? raw.group?.city ?? DEFAULT_CITY,
        date: normalizeDate(raw.dateTime),
        time: normalizeTime(raw.dateTime),
        timezone: raw.group?.timezone ?? DEFAULT_TZ,
        mode: raw.type === 'ONLINE' ? 'online' : 'offline',
        organizer: raw.group?.name ?? 'Meetup',
        tags: ['tech'],
        url: raw.eventUrl,
        source,
        sourceId: raw.id,
        isFree: raw.feeSettings == null,
      };
    }

    case 'mlh':
    case 'company': {
      // Playwright/fetch-scraped pages: provide a pre-shaped object from the scraper.
      return {
        title: raw.title,
        description: (raw.description ?? '').slice(0, 1000),
        image: raw.image ?? '',
        venue: raw.venue ?? '',
        country: raw.country ?? DEFAULT_COUNTRY,
        city: raw.city ?? DEFAULT_CITY,
        date: normalizeDate(raw.date),
        time: raw.time ? normalizeTime(raw.time) : '09:00',
        endDate: raw.endDate ? normalizeDate(raw.endDate) : undefined,
        timezone: raw.timezone ?? DEFAULT_TZ,
        mode: inferMode(raw.venue, raw.isOnline),
        organizer: raw.organizer ?? (source === 'mlh' ? 'MLH' : 'Company'),
        tags: raw.tags?.length ? raw.tags : ['tech'],
        url: raw.url,
        source,
        category: source === 'mlh' ? 'hackathon' : mapCategory(raw.category),
      };
    }
  }
}

function mapCategory(v?: string): CanonicalEvent['category'] {
  const s = (v ?? '').toLowerCase();
  if (/hack/.test(s)) return 'hackathon';
  if (/meet/.test(s)) return 'meetup';
  if (/conf|summit|expo/.test(s)) return 'conference';
  if (/network|social|mixer/.test(s)) return 'networking';
  return undefined;
}
```

### Notes

- **Toronto focus:** `country`/`city` default to `Canada`/`Toronto`, and `timezone`
  defaults to `America/Toronto` (IANA) — this is the value the calendar-export button
  passes as `timeZone`, so it must be a real IANA name, never an offset.
- **`description` is capped at 1000** in the schema, so slice before assigning or the
  doc validation will reject it.
- **`tags` must be non-empty** (still required) — fall back to `['tech']` when the source
  gives nothing, so the doc validates.
- **`time` fallback:** company/MLH pages often omit a start time; default to `'09:00'`
  rather than dropping the event, since `time` is required.
- This function intentionally omits `slug` and `fingerprint`. Compute `slug` from `title`
  (reuse the `generateSlug` logic in `event.model.ts`) and `fingerprint` per the
  **deduplication skill** at the moment you build the upsert op.

### Wiring into a write (cross-ref database skill)

```ts
import { Event } from '@/database';
import connectDB from '@/database/mongodb';
import { normalizeRawEvent } from '@/database/normalize';
import { buildFingerprint } from '@/database'; // from the deduplication skill

await connectDB();

const doc = normalizeRawEvent(raw, 'luma');
const fingerprint = buildFingerprint(doc); // sha256(title|date|city) — see dedup skill

await Event.updateOne(
  { fingerprint },
  { $set: doc, $setOnInsert: { fingerprint, slug: makeSlug(doc.title) } },
  { upsert: true }
);
```

See the **database skill** for `bulkWrite`, `ordered:false`, and E11000 handling, and the
**deduplication skill** for the exact `fingerprint` hash.
