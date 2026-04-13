// Load env.config first — imports dotenv/config so betterAuth() can read BETTER_AUTH_SECRET
import { env } from '@/engine/config/env.config.js';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
// Import the shared singleton exported from the database workspace package — avoids TS6059
// rootDir errors while keeping the Prisma client lifecycle owned in one place.
import { prisma } from 'database';
// JSON file adapter — used when DATABASE_TYPE=json for zero-dependency local development.
// Shares the same data.json store as the rest of the JSON adapter layer so auth tables
// and bot tables coexist in a single file without cross-package coupling.
import { jsonAdapter } from './better-auth-adapter.lib.js';

const isJson = env.DATABASE_TYPE === 'json';

export const auth = betterAuth({
  database: isJson
    ? jsonAdapter()
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
