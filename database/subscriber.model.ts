import { Schema, model, models, Document } from 'mongoose';
import { randomBytes } from 'node:crypto';

/**
 * Digest subscribers — one doc per email address, carrying that person's own
 * filters and their own delivery cursor. Per-subscriber state (rather than the
 * old global marker) is what makes multiple recipients with different interests
 * possible: A can be told about a hackathon that B's filters exclude, and B
 * still hears about it later if their filters change. (ADR-026)
 */
export interface ISubscriber extends Document {
    email: string;
    /** Unguessable id used for unsubscribe + preference links in emails. */
    token: string;
    status: 'active' | 'unsubscribed';
    /** What they want to hear about. */
    topics: ('hackathon' | 'company' | 'community')[];
    /** Where. ONLINE = joinable from anywhere. */
    regions: ('CA' | 'US' | 'ONLINE')[];
    /** US in-person hackathons only when travel reimbursement is known-offered. */
    usTravelOnly: boolean;
    /** Skip anything starting sooner than this — hackathon applications close early. */
    minDaysOut: number;
    /** How often a digest may go out. Weekly by default: hackathon news moves in weeks. */
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    /** Considered-through cursor for "new since last digest". */
    lastDigestAt?: Date;
    /** Last actual send (same-day rerun guard). */
    lastSentAt?: Date;
    /** Event ids already announced as "applications open" to THIS subscriber. */
    notifiedOpenIds: string[];
    unsubscribedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export function newSubscriberToken(): string {
    return randomBytes(24).toString('hex');
}

/** Minimum days between sends, per cadence. */
export const FREQUENCY_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };

const SubscriberSchema = new Schema<ISubscriber>(
    {
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
        },
        token: { type: String, required: true, unique: true, default: newSubscriberToken },
        status: { type: String, enum: ['active', 'unsubscribed'], default: 'active' },
        topics: {
            type: [String],
            enum: ['hackathon', 'company', 'community'],
            default: ['hackathon'],
            validate: { validator: (v: string[]) => v.length > 0, message: 'Pick at least one topic' },
        },
        regions: {
            type: [String],
            enum: ['CA', 'US', 'ONLINE'],
            default: ['CA', 'US'],
            validate: { validator: (v: string[]) => v.length > 0, message: 'Pick at least one region' },
        },
        usTravelOnly: { type: Boolean, default: false },
        minDaysOut: { type: Number, default: 21, min: 0, max: 180 },
        frequency: { type: String, enum: ['daily', 'weekly', 'biweekly', 'monthly'], default: 'weekly' },
        lastDigestAt: { type: Date },
        lastSentAt: { type: Date },
        notifiedOpenIds: { type: [String], default: [] },
        unsubscribedAt: { type: Date },
    },
    { timestamps: true, collection: 'subscribers' },
);

const Subscriber = models.Subscriber || model<ISubscriber>('Subscriber', SubscriberSchema);

export default Subscriber;
