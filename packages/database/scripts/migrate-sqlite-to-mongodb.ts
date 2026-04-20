/**
 * migrate-sqlite-to-mongodb
 * Direct migration from Prisma/SQLite to MongoDB.
 */
import '../scripts/load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '../adapters/prisma-sqlite/src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbRoot = path.resolve(__dirname, '..');

// SQLITE_DATABASE_URL prioritised to avoid conflict if DATABASE_URL points to Neon
const rawUrl = process.env['SQLITE_DATABASE_URL'] ?? process.env['DATABASE_URL'];
const DB_SQLITE_FILE = rawUrl ? rawUrl.replace(/^file:/, '') : path.resolve(dbRoot, 'database/database.sqlite');

const collectionsMap: Record<string, string> = {
  botSessionCommand: 'botSessionCommands', botSessionEvent: 'botSessionEvents', botCredentialDiscord: 'botCredentialDiscord',
  botCredentialTelegram: 'botCredentialTelegram', botCredentialFacebookPage: 'botCredentialFacebookPage',
  botCredentialFacebookMessenger: 'botCredentialFacebookMessenger', botSession: 'botSessions', botAdmin: 'botAdmins',
  botPremium: 'botPremiums', botUser: 'botUsers', fbPageWebhook: 'fbPageWebhooks', systemAdmin: 'systemAdmin',
  botThreadSession: 'botThreadSessions', botUserSession: 'botUserSessions', botUserBanned: 'botUserBanned',
  botThreadBanned: 'botThreadBanned', user: 'user', session: 'session', account: 'account', verification: 'verification',
};

const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function convertDates(obj: any): any {
  if (typeof obj === 'string' && isoDateRegex.test(obj)) return new Date(obj);
  if (Array.isArray(obj)) return obj.map(convertDates);
  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Date) return obj; // Prisma dates pass through natively
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = convertDates(v);
    return out;
  }
  return obj;
}

async function main() {
  console.log(`sqlite-to-mongodb migration`);
  console.log(`  Source : ${DB_SQLITE_FILE}`);
  
  const adapter = new PrismaBetterSqlite3({ url: `file:${DB_SQLITE_FILE}` });
  const prisma = new PrismaClient({ adapter } as any);

  const safeFind = <T>(p: Promise<T>): Promise<T> => p.catch((e: any) => { console.warn(`[WARN] ${e.message}`); return[] as unknown as T; });

  console.log('Reading from SQLite...');
  const[
    user, session, account, verification, botSession, botAdmin, botCredentialDiscord, botCredentialTelegram,
    botCredentialFacebookPage, botCredentialFacebookMessenger, botUser, botThreads, botUserSession,
    botThreadSession, fbPageWebhook, botSessionCommand, botSessionEvent, botUserBanned, botThreadBanned, systemAdmin
  ] = await Promise.all([
    safeFind(prisma.user.findMany()), safeFind(prisma.session.findMany()), safeFind(prisma.account.findMany()), safeFind(prisma.verification.findMany()),
    safeFind(prisma.botSession.findMany()), safeFind(prisma.botAdmin.findMany()), safeFind(prisma.botCredentialDiscord.findMany()),
    safeFind(prisma.botCredentialTelegram.findMany()), safeFind(prisma.botCredentialFacebookPage.findMany()),
    safeFind(prisma.botCredentialFacebookMessenger.findMany()), safeFind(prisma.botUser.findMany()),
    safeFind(prisma.botThread.findMany({ include: { participants: { select: { id: true } }, admins: { select: { id: true } } } })),
    safeFind(prisma.botUserSession.findMany()), safeFind(prisma.botThreadSession.findMany()), safeFind(prisma.fbPageWebhook.findMany()),
    safeFind(prisma.botSessionCommand.findMany()), safeFind(prisma.botSessionEvent.findMany()), safeFind(prisma.botUserBanned.findMany()),
    safeFind(prisma.botThreadBanned.findMany()), safeFind(prisma.systemAdmin.findMany())
  ]);

  const botThread = botThreads.map((t) => ({
    platformId: t.platformId, id: t.id, name: t.name, isGroup: t.isGroup, memberCount: t.memberCount,
    avatarUrl: t.avatarUrl, createdAt: t.createdAt, updatedAt: t.updatedAt,
    participants: t.participants.map((p) => p.id), admins: t.admins.map((a) => a.id),
  }));

  const db: Record<string, any[]> = {
    user, session, account, verification, botUser, botThread, botSession, botAdmin, botPremium: [],
    botCredentialDiscord, botCredentialTelegram, botCredentialFacebookPage, botCredentialFacebookMessenger,
    botUserSession, botThreadSession, fbPageWebhook, botSessionCommand, botSessionEvent, botUserBanned, botThreadBanned, systemAdmin
  };

  const mongoDb = getMongoDb();
  console.log('Writing to MongoDB...');

  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    await mongoDb.collection(mongoCol).deleteMany({}).catch((e: any) => console.warn(`[WARN] Delete failed for ${mongoCol}: ${e.message}`));
    const rows = db[jsonKey] ||[];
    if (rows.length > 0) {
      const docs = rows.map(convertDates).map((r) => {
        // Map 'id' back to '_id' for better-auth so it can natively query these records via ObjectId/String _id
        if (r.id && ['user', 'session', 'account', 'verification'].includes(jsonKey)) {
          r._id = r.id;
          delete r.id;
        }
        return r;
      });
      try {
        await mongoDb.collection(mongoCol).insertMany(docs);
      } catch (e: any) {
        console.warn(`[WARN] Insert failed for ${mongoCol}: ${e.message}`);
      }
      console.log(`  ${jsonKey.padEnd(34)} ${rows.length}`);
    }
  }

  await mongoDb.collection('botThreads').deleteMany({}).catch((e: any) => console.warn(`[WARN] Delete failed for botThreads: ${e.message}`));
  const threads = db.botThread;
  if (threads && threads.length > 0) {
    const threadDocs = threads.map((t) => {
      const { participants, admins, ...rest } = t;
      return convertDates({ ...rest, participantIDs: participants || [], adminIDs: admins || [] });
    });
    try {
      await mongoDb.collection('botThreads').insertMany(threadDocs);
    } catch (e: any) {
      console.warn(`[WARN] Insert failed for botThreads: ${e.message}`);
    }
    console.log(`  ${'botThread'.padEnd(34)} ${threadDocs.length}`);
  }

  console.log('\nMigration complete.');
  await prisma.$disconnect();
  await mongoClient.close();
}

main().catch((err) => { console.error('Migration failed:', err); process.exit(1); });
