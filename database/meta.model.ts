import { Schema, model, models, Document } from 'mongoose';

/**
 * Singleton bookkeeping doc for the scrape pipeline — powers the "Updated X ago"
 * freshness indicator. One document, `key: 'scrape'`, rewritten after each run.
 */
export interface IScrapeMeta extends Document {
    key: string;
    lastRunAt: Date;
    /** Per-source last-success timestamp (ISO), e.g. { company: '2026-06-20T...' }. */
    perSource: Record<string, string>;
    lastSources: string[];
    lastUpserted: number;
    lastModified: number;
    lastErrors: string[];
}

const ScrapeMetaSchema = new Schema<IScrapeMeta>(
    {
        key: { type: String, required: true, unique: true, default: 'scrape' },
        lastRunAt: { type: Date },
        perSource: { type: Schema.Types.Mixed, default: {} },
        lastSources: { type: [String], default: [] },
        lastUpserted: { type: Number, default: 0 },
        lastModified: { type: Number, default: 0 },
        lastErrors: { type: [String], default: [] },
    },
    { timestamps: true, collection: 'meta' },
);

const ScrapeMeta = models.ScrapeMeta || model<IScrapeMeta>('ScrapeMeta', ScrapeMetaSchema);

export default ScrapeMeta;

/**
 * Singleton cursor for the email digest (lib/notify/digest.ts) — same
 * collection, `key: 'digest'`. lastDigestAt = "considered through" (advances
 * even on empty runs so the window stays bounded); lastSentAt = last actual
 * email (drives the same-day rerun guard). At-least-once: both only advance
 * after Resend confirms the send. (ADR-021)
 */
export interface IDigestMeta extends Document {
    key: string;
    lastDigestAt: Date;
    lastSentAt?: Date;
    lastResult?: string;
}

const DigestMetaSchema = new Schema<IDigestMeta>(
    {
        key: { type: String, required: true, unique: true, default: 'digest' },
        lastDigestAt: { type: Date },
        lastSentAt: { type: Date },
        lastResult: { type: String },
    },
    { timestamps: true, collection: 'meta' },
);

export const DigestMeta = models.DigestMeta || model<IDigestMeta>('DigestMeta', DigestMetaSchema);
