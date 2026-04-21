/**
 * migrate-sqlite-to-json
 *
 * Reads every table from the SQLite database via PrismaClient and writes a
 * fully-populated database.json in the format expected by the JSON flat-file adapter.
 *
 * Usage (from packages/database/):
 *   npm run migrate:sqlite-to-json
 *
 * Prerequisites:
 *   - Run `npx prisma generate` inside adapters/prisma-sqlite/ at least once so the
 *     generated client exists.
 *   - Set DATABASE_URL in .env if the sqlite file is not at the default path.
 *
 * Safety: this script is read-only against SQLite and overwrites database.json.
 * Back up database.json before running if it contains data you want to preserve.
 */
import '../scripts/load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

// Import the generated client directly — avoids pulling in the singleton from client.ts
// (which caches to globalThis) so the migration process gets a clean, isolated connection.
import { PrismaClient } from '../adapters/prisma-sqlite/src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// packages/database/src → packages/database
const dbRoot = path.resolve(__dirname, '..');
const DB_JSON_FILE = path.resolve(dbRoot, 'database/database.json');

// Honour DATABASE_URL when set; strip the "file:" prefix that SQLite URLs carry.
const rawUrl = process.env['DATABASE_URL'];
const DB_SQLITE_FILE = rawUrl
  ? rawUrl.replace(/^file:/, '')
  : path.resolve(dbRoot, 'database/database.sqlite');

async function main(): Promise<void> {
  console.log('sqlite-to-json migration');
  console.log(`  SQLite : ${DB_SQLITE_FILE}`);
  console.log(`  Output : ${DB_JSON_FILE}`);
  console.log('');

  const adapter = new PrismaBetterSqlite3({ url: `file:${DB_SQLITE_FILE}` });
  const prisma = new PrismaClient({ adapter } as ConstructorParameters<
    typeof PrismaClient
  >[0]);

  // Mute errors if better-auth introduces tables SQLite does not yet possess.
  const safeFind = <T>(p: Promise<T>): Promise<T> =>
    p.catch((e: any) => {
      console.warn(`[WARN] ${e.message}`);
      return [] as unknown as T;
    });

  console.log('Reading tables from SQLite…');

  // Fetch all 19 tables in parallel — safe because this is read-only.
  const [
    users,
    sessions,
    accounts,
    verifications,
    botSessions,
    botAdmins,
    botCredentialDiscord,
    botCredentialTelegram,
    botCredentialFacebookPage,
    botCredentialFacebookMessenger,
    botUsers,
    // BotThread uses implicit M:M for participants and admins — include them so we can
    // flatten to ID arrays matching the JSON store's flat { participants: string[] } shape.
    botThreads,
    botUserSessions,
    botThreadSessions,
    fbPageWebhooks,
    botSessionCommands,
    botSessionEvents,
    botUserBanned,
    botThreadBanned,
  ] = await Promise.all([
    safeFind(prisma.user.findMany()),
    safeFind(prisma.session.findMany()),
    safeFind(prisma.account.findMany()),
    safeFind(prisma.verification.findMany()),
    safeFind(prisma.botSession.findMany()),
    safeFind(prisma.botAdmin.findMany()),
    safeFind(prisma.botCredentialDiscord.findMany()),
    safeFind(prisma.botCredentialTelegram.findMany()),
    safeFind(prisma.botCredentialFacebookPage.findMany()),
    safeFind(prisma.botCredentialFacebookMessenger.findMany()),
    safeFind(prisma.botUser.findMany()),
    safeFind(
      prisma.botThread.findMany({
        include: {
          participants: { select: { id: true } },
          admins: { select: { id: true } },
        },
      }),
    ),
    safeFind(prisma.botUserSession.findMany()),
    safeFind(prisma.botThreadSession.findMany()),
    safeFind(prisma.fbPageWebhook.findMany()),
    safeFind(prisma.botSessionCommand.findMany()),
    safeFind(prisma.botSessionEvent.findMany()),
    safeFind(prisma.botUserBanned.findMany()),
    safeFind(prisma.botThreadBanned.findMany()),
  ]);

  // Flatten Prisma M:M relation objects → plain string[] so the JSON file matches
  // the schema that the JSON adapter's threads.repo.ts writes and reads.
  const mappedBotThreads = botThreads.map((t) => ({
    platformId: t.platformId,
    id: t.id,
    name: t.name,
    isGroup: t.isGroup,
    memberCount: t.memberCount,
    avatarUrl: t.avatarUrl,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    participants: t.participants.map((p) => p.id),
    admins: t.admins.map((a) => a.id),
  }));

  const db = {
    // better-auth core tables
    user: users,
    session: sessions,
    account: accounts,
    verification: verifications,
    // bot identity
    botUser: botUsers,
    botThread: mappedBotThreads,
    // per-session config
    botSession: botSessions,
    botAdmin: botAdmins,
    botCredentialDiscord,
    botCredentialTelegram,
    botCredentialFacebookPage,
    botCredentialFacebookMessenger,
    // session tracking join tables
    botUserSession: botUserSessions,
    botThreadSession: botThreadSessions,
    // webhooks
    fbPageWebhook: fbPageWebhooks,
    // command / event overrides
    botSessionCommand: botSessionCommands,
    botSessionEvent: botSessionEvents,
    // bans
    botUserBanned,
    botThreadBanned,
  };

  // Ensure the output directory exists (first run with no database/ folder yet).
  await fs.mkdir(path.dirname(DB_JSON_FILE), { recursive: true });
  await fs.writeFile(DB_JSON_FILE, JSON.stringify(db, null, 2), 'utf-8');

  console.log('Migration complete. Row counts:');
  for (const [table, rows] of Object.entries(db)) {
    if ((rows as unknown[]).length > 0) {
      console.log(`  ${table.padEnd(34)} ${(rows as unknown[]).length}`);
    }
  }
  console.log(`\nWritten to: ${DB_JSON_FILE}`);

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
