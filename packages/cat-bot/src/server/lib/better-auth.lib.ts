// Load env.config first — imports dotenv/config so betterAuth() can read BETTER_AUTH_SECRET
import { env } from '@/engine/config/env.config.js';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
// MongoDB adapter — bundled via @better-auth/mongo-adapter; only evaluated when DATABASE_TYPE=mongodb.
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
// Import the shared singleton exported from the database workspace package — avoids TS6059
// rootDir errors while keeping the Prisma client lifecycle owned in one place.
// mongoClient and getMongoDb are undefined at runtime when DATABASE_TYPE !== 'mongodb'.
import { prisma, mongoClient, getMongoDb } from 'database';
// JSON file adapter — used when DATABASE_TYPE=json for zero-dependency local development.
// Shares the same data.json store as the rest of the JSON adapter layer so auth tables
// and bot tables coexist in a single file without cross-package coupling.
import { jsonAdapter } from './better-auth-adapter.lib.js';

const isJson  = env.DATABASE_TYPE === 'json';
const isMongo = env.DATABASE_TYPE === 'mongodb';

export const auth = betterAuth({
  database: isJson
    ? jsonAdapter()
    // MongoDB driver — mongodbAdapter() receives a Db instance; mongoClient is optional for
    // transactions (disabled on Atlas M0 free tier which lacks replica-set support).
    // getMongoDb/mongoClient are typed `any` in the database barrel so the cast is needed
    // to satisfy strict-mode while keeping the dynamic adapter pattern.
     
    : isMongo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? mongodbAdapter((getMongoDb as unknown as () => any)(), { client: mongoClient })
    : // SQLite driver — matches the adapter-better-sqlite3 configured in packages/database/client.ts
      prismaAdapter(prisma, { provider: 'sqlite' }),
  emailAndPassword: {
    // Enables POST /api/auth/sign-up/email and POST /api/auth/sign-in/email out of the box
    enabled: true,
  },
  // Trust the dynamic dev server URL if provided. In production, same-origin is inherently trusted.
  trustedOrigins: env.VITE_URL
    ? [env.VITE_URL]
    : undefined,
});
