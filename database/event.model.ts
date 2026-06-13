import { Schema, model, models, Document } from 'mongoose';
import { normalizeDate, normalizeTime } from './normalize';


export interface IEvent extends Document {
    title: string;
    slug: string;
    description: string;
    overview?: string;            // often missing on scraped sources
    image: string;
    venue: string;
    country: string;
    city: string;
    date: string;                 // YYYY-MM-DD
    time: string;                 // HH:MM (24h)
    endDate?: string;             // YYYY-MM-DD
    endTime?: string;             // HH:MM (24h)
    timezone: string;             // IANA, e.g. America/Toronto — needed for calendar export
    mode: string;                 // online | offline | hybrid
    audience?: string;            // often missing on scraped sources
    agenda?: string[];            // often missing on scraped sources
    organizer: string;
    tags: string[];
    url: string;                  // canonical link to the source event page
    source: 'luma' | 'eventbrite' | 'meetup' | 'mlh' | 'company';
    sourceId?: string;            // platform-native id, when available
    fingerprint?: string;         // dedup key — set by the scraper upsert path
    isFree?: boolean;
    price?: string;
    category?: 'hackathon' | 'meetup' | 'conference' | 'networking';
    region?: 'CA' | 'US' | 'ONLINE' | 'INTL' | 'UNKNOWN'; // North-America scope (derived in normalize)
    createdAt: Date;
    updatedAt: Date;
}

const EventSchema = new Schema<IEvent>(
    {
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true,
        trim: true,
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true,
        maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    overview: {
        type: String,
        trim: true,
        maxlength: [500, 'Overview cannot exceed 500 characters'],
    },
    image: {
        type: String,
        required: [true, 'Image URL is required'],
        trim: true,
    },
    venue: {
        type: String,
        required: [true, 'Venue is required'],
        trim: true,
    },
    country: {
        type: String,
        required: [true, 'Country is required'],
        trim: true,
    },
    city: {
        type: String,
        required: [true, 'City is required'],
        trim: true,
    },
    date: {
        type: String,
        required: [true, 'Date is required'],
    },
    time: {
        type: String,
        required: [true, 'Time is required'],
    },
    mode: {
        type: String,
        required: [true, 'Mode is required'],
        enum: {
        values: ['online', 'offline', 'hybrid'],
        message: 'Mode must be either online, offline, or hybrid',
        },
    },
    audience: {
        type: String,
        trim: true,
    },
    agenda: {
        type: [String],
        default: [],
    },
    organizer: {
        type: String,
        required: [true, 'Organizer is required'],
        trim: true,
    },
    tags: {
        type: [String],
        required: [true, 'Tags are required'],
        validate: {
            validator: (v: string[]) => v.length > 0,
            message: 'At least one tag is required',
            },
        },
    endDate:  { type: String },
    endTime:  { type: String },
    timezone: { type: String, default: 'America/Toronto' },
    url:      { type: String, required: [true, 'Source URL is required'], trim: true },
    source:   { type: String, enum: ['luma', 'eventbrite', 'meetup', 'mlh', 'company'], required: [true, 'Source is required'] },
    sourceId: { type: String, trim: true },
    fingerprint: { type: String },
    isFree:   { type: Boolean },
    price:    { type: String, trim: true },
    category: { type: String, enum: ['hackathon', 'meetup', 'conference', 'networking'] },
    region:   { type: String, enum: ['CA', 'US', 'ONLINE', 'INTL', 'UNKNOWN'] },
    },
    {
        timestamps: true, // Auto-generate createdAt and updatedAt
    }
);

// Pre-save hook for slug generation and data normalization
// (Mongoose 9 middleware: no next() — return to continue, throw to abort)
EventSchema.pre('save', function () {
    const event = this as IEvent;

    // Generate slug only if title changed or document is new
    if (event.isModified('title') || event.isNew) {
        event.slug = generateSlug(event.title);
    }

    // Normalize date to ISO format if it's not already
    if (event.isModified('date')) {
        event.date = normalizeDate(event.date);
    }

    // Normalize time format (HH:MM)
    if (event.isModified('time')) {
        event.time = normalizeTime(event.time);
    }
});


// Helper function to generate URL-friendly slug
// Exported so the scraper upsert path (bulkWrite — pre-save hooks don't run) can reuse it
export function generateSlug(title: string): string {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

// Create unique index on slug for better performance
EventSchema.index({ slug: 1 }, { unique: true });

// Dedup key — sparse so hand-entered events without a fingerprint don't collide on null
EventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });

// Compound indexes for the feed's filter paths (each filter field + date ordering)
EventSchema.index({ mode: 1, date: 1 });
EventSchema.index({ city: 1, date: 1 });
EventSchema.index({ tags: 1, date: 1 });
EventSchema.index({ region: 1, date: 1 });
EventSchema.index({ date: 1, _id: 1 });

// Full-text search for the keyword (?q=) filter
EventSchema.index({ title: 'text', description: 'text', tags: 'text' });

const Event = models.Event || model<IEvent>('Event', EventSchema);

export default Event;

