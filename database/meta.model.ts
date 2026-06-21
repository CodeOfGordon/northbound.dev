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
