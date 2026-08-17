/**
 * Server-side reads for the digest subscription pages. Kept fail-safe (null on
 * any DB trouble) because these render on request paths where a database blip
 * should degrade to the plain signup form, never a 500 — same doctrine as
 * lib/meta.ts (invariant I8).
 */
import 'server-only';
import connectDB from '@/database/mongodb';
import { Subscriber } from '@/database';

export interface SubscriberView {
    email: string;
    topics: string[];
    regions: string[];
    usTravelOnly: boolean;
    minDaysOut: number;
    status: 'active' | 'unsubscribed';
}

export async function getSubscriberByToken(token?: string): Promise<SubscriberView | null> {
    if (!token) return null;
    try {
        await connectDB();
        const doc = await Subscriber.findOne({ token }).lean<{
            email: string; topics: string[]; regions: string[];
            usTravelOnly: boolean; minDaysOut: number; status: 'active' | 'unsubscribed';
        } | null>();
        if (!doc) return null;
        return {
            email: doc.email,
            topics: doc.topics ?? [],
            regions: doc.regions ?? [],
            usTravelOnly: !!doc.usTravelOnly,
            minDaysOut: doc.minDaysOut ?? 21,
            status: doc.status ?? 'active',
        };
    } catch {
        return null;
    }
}
