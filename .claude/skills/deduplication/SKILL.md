---
name: deduplication
description: Use when deduplicating events that appear on multiple sources. Covers the fingerprint hash strategy and Mongo upsert-on-fingerprint via updateOne/bulkWrite.
---

# Event Deduplication (fingerprint + upsert)

Northbound scrapes the same event from many sources: Luma, Eventbrite, Meetup, MLH, and
company sites (RBC, GDG, AWS, Databricks). The same Toronto meetup routinely shows up on
two or three of them. We collapse those into ONE `Event` document with a deterministic
**fingerprint** that becomes a unique key, then **upsert on that fingerprint** so re-runs
are idempotent.

Relevant files in this repo:
- `database/event.model.ts` — the `Event` model + `IEvent` interface and pre-save hooks.
- `database/mongodb.ts` — `connectDB()` (cached global connection, `bufferCommands:false`).
- `database/index.ts` — barrel: `export { Event }`, `export type { IEvent }`.

## The fingerprint strategy

The fingerprint is `sha256` of three identity fields, joined with `|`:

```
sha256( lowercased+trimmed title | date(YYYY-MM-DD) | lowercased+trimmed city )
```

Rules and rationale:
- **Lowercase + trim + collapse whitespace** on `title` and `city` so `"AI Tuesdays "`
  and `"ai tuesdays"` match. Sources capitalize and pad inconsistently.
- **`date` is already a `YYYY-MM-DD` string** (the model normalizes it). Use it verbatim.
- **EXCLUDE `time`.** Sources disagree by minutes (doors vs. start, UTC rounding), so
  including time would split one real event into duplicates. City + date + title is the
  stable human identity of an event.
- **Do not include `venue`, `organizer`, or `url`** — they vary across sources for the
  same event (online vs. offline listings, different organizer handles, source-specific
  links). Keep the fingerprint to the three fields above so cross-source matches collapse.

### Computing it with Node crypto

Add an exported helper to `database/event.model.ts` (export it so the scraper builds the
*exact* same string the model expects):

```ts
// database/event.model.ts
import { createHash } from 'node:crypto';

/** Normalize a free-text field the same way on every source. */
function normKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Deterministic dedup key. date must already be YYYY-MM-DD.
 * Excludes time on purpose (sources disagree by minutes).
 */
export function buildFingerprint(e: Pick<IEvent, 'title' | 'date' | 'city'>): string {
  const basis = `${normKey(e.title)}|${e.date}|${normKey(e.city)}`;
  return createHash('sha256').update(basis).digest('hex');
}
```

Then re-export it from the barrel so callers import from `@/database`:

```ts
// database/index.ts
export { default as Event, buildFingerprint } from './event.model';
```

## Schema additions (propose as a diff — do NOT rewrite the whole file)

`fingerprint` and the source/url fields are aggregator extensions. Add them to `IEvent`
and `EventSchema`; the `url` field is REQUIRED for this product (canonical source link).

```ts
// add to interface IEvent
fingerprint: string;
url: string;                  // canonical link to the event page on its source site
source: 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';
sourceId?: string;            // platform id on that source

// add to EventSchema fields
fingerprint: { type: String, required: true },
url:         { type: String, required: [true, 'Source URL is required'], trim: true },
source:      { type: String, enum: ['luma','eventbrite','meetup','mlh','company'], required: true },
sourceId:    { type: String, trim: true },
```

### Unique sparse index on fingerprint

This is the dedup enforcement. `sparse` lets any legacy/hand-entered docs without a
fingerprint coexist without tripping the unique constraint.

```ts
// database/event.model.ts (alongside the existing slug + {date,mode} indexes)
EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });
```

> `autoIndex` is on by default in dev, so this index builds on model init. In production
> prefer `autoIndex: false` and run `Event.syncIndexes()` on deploy.

## CRITICAL: pre-save hooks do NOT run on upserts

`database/event.model.ts` normalizes `slug`, `date`, and `time` in a `pre('save')` hook.
**That hook fires only on `.save()` / `.create()` — NOT on `updateOne` / `bulkWrite`.**
So for upserts you MUST normalize before the call:

- Normalize `date` to `YYYY-MM-DD` and `time` to `HH:MM` yourself in the scraper.
- Compute the `slug` yourself, and the `fingerprint` from the already-normalized fields.

Move/expose the model's `generateSlug` / `normalizeDate` / `normalizeTime` as exported pure
functions and call them in the scraper, or replicate the same logic.

## Idempotent upsert — single doc

`$set` the fields that may change between scrapes; `$setOnInsert` create-only fields so a
re-scrape never clobbers the original `fingerprint`/`source`/`slug`.

```ts
import connectDB from '@/database/mongodb';
import { Event, buildFingerprint } from '@/database';

await connectDB();                         // first awaited line; bufferCommands:false fails fast otherwise

const fingerprint = buildFingerprint(scraped);   // scraped.date already YYYY-MM-DD

await Event.updateOne(
  { fingerprint },
  {
    $set: {                                // refreshed every scrape
      title: scraped.title,
      description: scraped.description,
      image: scraped.image,
      venue: scraped.venue,
      country: scraped.country,
      city: scraped.city,
      date: scraped.date,                  // YYYY-MM-DD
      time: scraped.time,                  // HH:MM
      mode: scraped.mode,                  // online | offline | hybrid
      tags: scraped.tags,
      organizer: scraped.organizer,
      url: scraped.url,                    // canonical source link
    },
    $setOnInsert: {                        // only when first inserted
      fingerprint,
      source: scraped.source,
      sourceId: scraped.sourceId,
      slug: makeUniqueSlug(scraped.title), // hooks don't run here — build it yourself
    },
  },
  { upsert: true },
);
```

> Note: `overview`, `agenda`, and `audience` are `required` in the current schema but are
> often absent from scraped sources. Relax them to optional for scraped events (see PROJECT
> CANON), otherwise validators block inserts. Validators run on `runValidators:true`
> upserts; by default `updateOne` does not run schema validators, but the required fields
> still bite you the moment you turn validation on or `.create()` a doc.

## Idempotent upsert — batches with bulkWrite

One round trip for a whole scrape batch. Use `ordered: false` so one bad doc doesn't abort
the rest.

```ts
import connectDB from '@/database/mongodb';
import { Event, buildFingerprint } from '@/database';

await connectDB();

const ops = scrapedBatch.map((s) => {
  const fingerprint = buildFingerprint(s);
  return {
    updateOne: {
      filter: { fingerprint },
      update: {
        $set: {
          title: s.title, description: s.description, image: s.image,
          venue: s.venue, country: s.country, city: s.city,
          date: s.date, time: s.time, mode: s.mode,
          tags: s.tags, organizer: s.organizer, url: s.url,
        },
        $setOnInsert: {
          fingerprint, source: s.source, sourceId: s.sourceId,
          slug: makeUniqueSlug(s.title),
        },
      },
      upsert: true,
    },
  };
});

try {
  const res = await Event.bulkWrite(ops, { ordered: false });
  // res.upsertedCount = new events, res.modifiedCount = refreshed existing
} catch (err) {
  handleBulkError(err);   // see below
}
```

## Handling the E11000 duplicate-key race

Two concurrent upserts with the same fingerprint can both miss the lookup and both try to
insert; the unique index rejects the loser with **`E11000 duplicate key error`**
(`err.code === 11000`). This is *expected and safe* — the index did its job, no dupe was
written. Treat it as benign.

Single upsert — retry once (the retry now matches the existing doc and `$set`-updates):

```ts
async function upsertEvent(filter: object, update: object, retries = 1): Promise<void> {
  try {
    await Event.updateOne(filter, update, { upsert: true });
  } catch (err: any) {
    if (err?.code === 11000 && retries > 0) {
      return upsertEvent(filter, update, retries - 1);  // now a plain update
    }
    throw err;
  }
}
```

bulkWrite with `ordered:false` — successful ops still commit; filter the 11000s out:

```ts
function handleBulkError(err: any) {
  if (err?.name === 'MongoBulkWriteError') {
    const fatal = (err.writeErrors ?? []).filter((e: any) => e.err?.code !== 11000);
    if (fatal.length) throw err;   // real failures only
    return;                        // all errors were benign dup-key races
  }
  throw err;
}
```

> A `slug` unique-index collision also surfaces as 11000 but on a different index. Tell them
> apart via `err.keyPattern` / `err.keyValue` (e.g. `err.keyPattern.slug` vs
> `err.keyPattern.fingerprint`) and regenerate the slug rather than dropping the event.

## Merge policy when the same event is on multiple sources

The fingerprint collapses cross-source duplicates into one doc, but the LAST scraper to run
otherwise wins via `$set`. To keep the richest data, merge intentionally instead of blind
`$set`:

1. **Description: keep the longest.** Scraped blurbs vary wildly in completeness.
   ```ts
   // only overwrite if the incoming description is richer
   const existing = await Event.findOne({ fingerprint }).select('description url source').lean();
   const description =
     (scraped.description?.length ?? 0) > (existing?.description?.length ?? 0)
       ? scraped.description
       : existing?.description ?? scraped.description;
   ```
2. **`url`: prefer the canonical source.** Rank sources and only replace the stored `url`
   when the incoming source outranks the stored one. Company/official pages and Luma are
   more canonical than aggregator re-listings.
   ```ts
   const RANK: Record<string, number> = { company: 5, mlh: 4, luma: 3, meetup: 2, eventbrite: 1 };
   const preferIncomingUrl = RANK[scraped.source] >= RANK[existing?.source ?? ''] ;
   const url = preferIncomingUrl ? scraped.url : existing?.url ?? scraped.url;
   ```
3. Apply the merged values in `$set`, keep `source`/`fingerprint`/`slug` in `$setOnInsert`.

For high volume, push the same logic into Mongo with `$max`/`$cond` in an aggregation
pipeline update so you avoid the read-then-write round trip:

```ts
await Event.updateOne(
  { fingerprint },
  [
    { $set: {
        // keep the longer description
        description: {
          $cond: [
            { $gt: [ { $strLenCP: { $ifNull: [scraped.description, ''] } },
                     { $strLenCP: { $ifNull: ['$description', ''] } } ] },
            scraped.description, '$description',
          ],
        },
        date: scraped.date, time: scraped.time, mode: scraped.mode,
        tags: scraped.tags, image: scraped.image,
        fingerprint, slug: { $ifNull: ['$slug', makeUniqueSlug(scraped.title)] },
      } },
  ],
  { upsert: true },
);
```

## Checklist

- [ ] `buildFingerprint` exported from `event.model.ts` and re-exported in `database/index.ts`.
- [ ] Fingerprint = `sha256(title|date|city)`, lowercased+trimmed, **time excluded**.
- [ ] `EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true })`.
- [ ] Normalize `date`/`time`/`slug` in the scraper — pre-save hooks do NOT run on upserts.
- [ ] Upsert with `$set` (mutable) + `$setOnInsert` (fingerprint/source/slug).
- [ ] `bulkWrite(ops, { ordered: false })` for batches; treat `code === 11000` as benign.
- [ ] Merge: longest description wins; most-canonical source wins the `url`.
