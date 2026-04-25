// Load env.config first — imports dotenv/config so betterAuth() can read BETTER_AUTH_SECRET
import { env } from '@/engine/config/env.config.js';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
// MongoDB adapter — bundled via @better-auth/mongo-adapter; only evaluated when DATABASE_TYPE=mongodb.
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
// Import the shared singleton exported from the database workspace package — avoids TS6059
// rootDir errors while keeping the Prisma client lifecycle owned in one place.
// mongoClient and getMongoDb are undefined at runtime when DATABASE_TYPE !== 'mongodb'.
import { prisma, mongoClient, getMongoDb, pool as neonPool } from 'database';
// JSON file adapter — used when DATABASE_TYPE=json for zero-dependency local development.
// Shares the same data.json store as the rest of the JSON adapter layer so auth tables
// and bot tables coexist in a single file without cross-package coupling.
import { jsonAdapter } from './better-auth-adapter.lib.js';
// Admin plugin — registers /api/auth/admin/* endpoints gated by user.role === 'admin'.
import { admin } from 'better-auth/plugins';
// createAuthMiddleware enables the adminAuth before-hook to inspect the sign-in body
// and reject non-admin users before a session row is ever written to the database.
import { createAuthMiddleware, APIError } from 'better-auth/api';

const isJson = env.DATABASE_TYPE === 'json';
const isMongo = env.DATABASE_TYPE === 'mongodb';
// NeonDB: better-auth natively accepts a pg.Pool via Kysely's PostgresDialect —
// no custom adapter is needed; the pool is passed directly as the database option.
const isNeon = env.DATABASE_TYPE === 'neondb';

export const auth = betterAuth({
  database: isJson
    ? jsonAdapter()
    : // NeonDB — neonPool is a pg.Pool; better-auth uses KyselyDialect(PostgresDialect) under the hood.
      // Neon is officially supported: https://better-auth.com/ (listed under Community databases).

      isNeon
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (neonPool as unknown as any)
      : // MongoDB driver — mongodbAdapter() receives a Db instance; mongoClient is optional for
        // transactions (disabled on Atlas M0 free tier which lacks replica-set support).
        // getMongoDb/mongoClient are typed `any` in the database barrel so the cast is needed
        // to satisfy strict-mode while keeping the dynamic adapter pattern.

        isMongo
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mongodbAdapter((getMongoDb as unknown as () => any)(), {
            client: mongoClient,
          })
        : // SQLite driver — matches the adapter-better-sqlite3 configured in packages/database/client.ts
          prismaAdapter(prisma, { provider: 'sqlite' }),
  emailAndPassword: {
    // Enables POST /api/auth/sign-up/email and POST /api/auth/sign-in/email out of the box
    enabled: true,
  },
  // Trust the dynamic dev server URL if provided. In production, same-origin is inherently trusted.
  trustedOrigins: env.VITE_URL ? [env.VITE_URL] : undefined,
  // Admin plugin provides /api/auth/admin/* endpoints (createUser, setRole, banUser, etc.).
  // Admin and user sessions are always independent: impersonation creates a new session row
  // with impersonatedBy = adminId while the admin's original session is never modified or revoked.
  plugins: [admin()],
  rateLimit: {
    // In-memory storage — no DB round-trips on every auth request. Resets on
    // process restart, which is acceptable for Cat-Bot's single-process deployment.
    enabled: true,
    window: 60,
    max: 100,
    storage: 'memory',
    customRules: {
      // 5 attempts / 10 s: generous for a human retyping a password but blocks
      // automated credential-stuffing lists that fire hundreds of requests per second.
      '/sign-in/email': { window: 10, max: 5 },
      // Prevent mass account creation from a single IP address.
      '/sign-up/email': { window: 60, max: 5 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return;
      const body = ctx.body as { email?: string } | undefined;
      if (!body?.email) return;

      const user = await ctx.context.adapter.findOne({
        model: 'user',
        where: [{ field: 'email', value: body.email }],
      });

      // Intercept banned users before better-auth attempts session creation — without this
      // hook, the admin plugin's internal ban check throws a generic "failed to create session"
      // error that gives the user no actionable information. By checking here first we can
      // surface the exact banReason stored by the bot admin.
      if (user !== null) {
        const u = user as Record<string, unknown>;
        if (u['banned'] === true) {
          const banExpires = u['banExpires'] as Date | null | undefined;
          // Respect temporary bans — if banExpires is set and has already passed the ban
          // has expired; fall through and let better-auth's own session creation proceed
          // (the admin plugin clears the ban flag automatically on next login).
          if (!banExpires || banExpires > new Date()) {
            const reason =
              (u['banReason'] as string | null | undefined) ??
              'No reason provided.';
            throw new APIError('FORBIDDEN', {
              message: `Your account has been banned. Reason: ${reason}`,
            });
          }
        }
      }
    }),
  },
});

// ── Admin Auth — second betterAuth instance for the /admin/* dashboard ────────────────
// Runs at a separate basePath (/api/admin-auth) and writes cookies with the prefix 'ba-admin'.
//
// Cookie independence guarantee:
//   User portal  → 'better-auth.session_token'  (set by `auth` at /api/auth)
//   Admin portal → 'ba-admin.session_token'      (set by `adminAuth` at /api/admin-auth)
//
// Both instances share the same underlying DB adapter — all user/session rows coexist in
// the same tables. Session tokens are unique per instance login so there is zero collision.
// Signing out of one portal never touches the other's cookie or session row.
export const adminAuth = betterAuth({
  basePath: '/api/admin-auth',
  database: isJson
    ? jsonAdapter()
    : isNeon
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (neonPool as unknown as any)
      : isMongo
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mongodbAdapter((getMongoDb as unknown as () => any)(), {
            client: mongoClient,
          })
        : prismaAdapter(prisma, { provider: 'sqlite' }),
  emailAndPassword: { enabled: true },
  trustedOrigins: env.VITE_URL ? [env.VITE_URL] : undefined,
  advanced: {
    // 'ba-admin' prefix → browser stores 'ba-admin.session_token'; completely separate from
    // the user auth cookie 'better-auth.session_token'. A person simultaneously logged in to
    // the user portal and the admin panel carries two independent HttpOnly cookies.
    cookiePrefix: 'ba-admin',
  },
  plugins: [admin()],
  rateLimit: {
    // Admin portal gets a stricter ceiling — admin accounts are high-value targets
    // and legitimate admins rarely hit sign-in repeatedly. 3 attempts / 10 s mirrors
    // better-auth's built-in default for the sign-in path.
    enabled: true,
    window: 60,
    max: 30,
    storage: 'memory',
    customRules: {
      '/sign-in/email': { window: 10, max: 3 },
    },
  },
  hooks: {
    // Top-level betterAuth() hooks accept a single createAuthMiddleware directly.
    // The { matcher, handler }[] array form is plugin-internal only — using it here
    // causes "hook.handler is not a function" because better-auth calls .handler()
    // on what it receives, but a plain object is not callable. Path filtering moves
    // inside the middleware body as a guard clause instead.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return;
      const body = ctx.body as { email?: string } | undefined;
      if (!body?.email) return; // malformed body — let main handler reject

      const user = await ctx.context.adapter.findOne({
        model: 'user',
        where: [{ field: 'email', value: body.email }],
      });

      // Check banned status BEFORE the role guard — when an account is both banned and
      // non-admin, the ban error is more specific and actionable than "admin access required".
      // Same expiry logic as the user-facing auth instance above: fall through on expired bans
      // so better-auth can clear the flag on the next successful sign-in attempt.
      if (user !== null) {
        const u = user as Record<string, unknown>;
        if (u['banned'] === true) {
          const banExpires = u['banExpires'] as Date | null | undefined;
          if (!banExpires || banExpires > new Date()) {
            const reason =
              (u['banReason'] as string | null | undefined) ??
              'No reason provided.';
            throw new APIError('FORBIDDEN', {
              message: `Your account has been banned. Reason: ${reason}`,
            });
          }
        }
      }

      // User exists but lacks admin role → reject before password verification.
      // Unknown user → fall through so the main handler returns "invalid credentials"
      // (avoids leaking which emails are registered vs which are non-admin).
      if (
        user !== null &&
        (user as Record<string, unknown>)['role'] !== 'admin'
      ) {
        return ctx.json(
          {
            message:
              'Admin access required. Only admin-role users may sign in here.',
          },
          { status: 403 },
        );
      }
    }),
  },
});
