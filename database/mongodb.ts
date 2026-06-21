import mongoose from 'mongoose';

// Define the connection cache type
type MongooseCache = {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
}

// Extend the global object to include our mongoose cache
declare global {
    var mongoose: MongooseCache | undefined;
}

const MONGODB_URI = process.env.MONGODB_URI;

// Initialize the cache on the global object to persist across hot reloads in development
const cached: MongooseCache = global.mongoose || { conn: null, promise: null };

if (!global.mongoose) {
    global.mongoose = cached;
}

/**
* Establishes a connection to MongoDB using Mongoose.
* Caches the connection to prevent multiple connections during development hot reloads.
* @returns Promise resolving to the Mongoose instance
*/
async function connectDB(): Promise<typeof mongoose> {
    // Return existing connection if available
    if (cached.conn) {
        return cached.conn;
    }

    // Return existing connection promise if one is in progress
    if (!cached.promise) {
        if (!MONGODB_URI) {
            throw new Error('MongoDB URI does not exist in env file');
        }
        const options = {
            bufferCommands: false,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 10000,
        };
        // Begin connecting to db (creates promise)
        cached.promise = mongoose.connect(MONGODB_URI!, options).then((mongoose) => {
            return mongoose;
        });
    }

    // Waiting for db connection (i.e. waiting for promise)
    try {
        cached.conn = await cached.promise;
    } catch(error) {
        cached.promise = null;
        throw error;
    }

    return cached.conn;
}
export default connectDB;