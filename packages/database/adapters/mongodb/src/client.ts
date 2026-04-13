// Load .env before any process.env access — MongoDB URI vars must be readable at module evaluation time.
import 'dotenv/config';
import { MongoClient, ServerApiVersion, type Db } from 'mongodb';

// ── Environment resolution ────────────────────────────────────────────────────

const MONGODB_URI_RAW    = process.env['MONGODB_URI'];
const MONGO_PASSWORD     = process.env['MONGO_PASSWORD'];
const MONGO_DATABASE_NAME = process.env['MONGO_DATABASE_NAME'];

if (!MONGODB_URI_RAW) {
  throw new Error(
    '[MongoDB] Missing required env var: MONGODB_URI\n' +
    'Set it in your .env file. See .env.example for the <PASSWORD> placeholder format.',
  );
}
if (!MONGO_DATABASE_NAME) {
  throw new Error(
    '[MongoDB] Missing required env var: MONGO_DATABASE_NAME\n' +
    'Set it to the name of the MongoDB database this bot should use.',
  );
}

// Replace the <PASSWORD> placeholder with a properly URI-encoded password so
// special characters (@ # $ % & + = space) in the password do not corrupt the
// connection string parser. The raw password is never logged.
const mongoUri: string = MONGO_PASSWORD
  ? MONGODB_URI_RAW.replace('<PASSWORD>', encodeURIComponent(MONGO_PASSWORD))
  : MONGODB_URI_RAW;

// ── Singleton guard ───────────────────────────────────────────────────────────
// tsx --watch and similar hot-reload systems re-evaluate modules on every file save.
// Without this guard, each reload opens a new MongoClient and leaks connection pool slots.
const globalForMongo = globalThis as unknown as {
  mongoClient: MongoClient | undefined;
};

export const mongoClient: MongoClient =
  globalForMongo.mongoClient ??
  new MongoClient(mongoUri, {
    serverApi: {
      // Stable API v1: fails loudly on deprecated or removed MongoDB server commands
      // rather than silently degrading — essential for Atlas compatibility and
      // catching issues during MongoDB Atlas / server version upgrades.
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

// Only pin to globalThis in dev; production processes boot once and never hot-reload.
if (process.env['NODE_ENV'] !== 'production') globalForMongo.mongoClient = mongoClient;

/**
 * Returns the Db instance for MONGO_DATABASE_NAME.
 * Called lazily — no connection is opened until the adapter makes its first query,
 * keeping the module safe to import in environments where DATABASE_TYPE !== 'mongodb'.
 */
export const getMongoDb = (): Db => mongoClient.db(MONGO_DATABASE_NAME);