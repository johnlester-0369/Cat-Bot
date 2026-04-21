/**
 * migrate-json-to-mongodb
 *
 * Reads every table from database.json and inserts the data into the target
 * MongoDB database.
 *
 * Usage (from packages/database/):
 *   npm run migrate:json-to-mongodb
 *
 * Prerequisites:
 *   - Set MONGODB_URI and MONGO_DATABASE_NAME in your .env file.
 *
 * WARNING: This script CLEARS the existing MongoDB collections before importing.
 * Back up your database before running if it contains data you want to keep.
 */
import './load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbRoot = path.resolve(__dirname, '..');
const DB_JSON_FILE = path.resolve(dbRoot, 'database/database.json');

const collectionsMap: Record<string, string> = {
  botSessionCommand: 'botSessionCommands',
  botSessionEvent: 'botSessionEvents',
  botCredentialDiscord: 'botCredentialDiscord',
  botCredentialTelegram: 'botCredentialTelegram',
  botCredentialFacebookPage: 'botCredentialFacebookPage',
  botCredentialFacebookMessenger: 'botCredentialFacebookMessenger',
  botSession: 'botSessions',
  botAdmin: 'botAdmins',
  botPremium: 'botPremiums',
  botUser: 'botUsers',
  fbPageWebhook: 'fbPageWebhooks',
  systemAdmin: 'systemAdmin',
  botThreadSession: 'botThreadSessions',
  botUserSession: 'botUserSessions',
  botUserBanned: 'botUserBanned',
  botThreadBanned: 'botThreadBanned',
  user: 'user',
  session: 'session',
  account: 'account',
  verification: 'verification',
};

// Deeply convert ISO string dates to native MongoDB Date objects
const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function convertDates(obj: any): any {
  if (typeof obj === 'string' && isoDateRegex.test(obj)) return new Date(obj);
  if (Array.isArray(obj)) return obj.map(convertDates);
  if (obj !== null && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = convertDates(v);
    return out;
  }
  return obj;
}

async function main(): Promise<void> {
  console.log('json-to-mongodb migration');
  console.log(`  Input  : ${DB_JSON_FILE}`);

  let raw: string;
  try {
    raw = await fs.readFile(DB_JSON_FILE, 'utf-8');
  } catch {
    console.error(`ERROR: ${DB_JSON_FILE} not found.`);
    process.exit(1);
  }

  const db = JSON.parse(raw) as Record<string, any[]>;
  const mongoDb = getMongoDb();

  console.log('Clearing existing MongoDB collections and inserting data...');

  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    await mongoDb
      .collection(mongoCol)
      .deleteMany({})
      .catch((e: any) =>
        console.warn(`[WARN] Delete failed for ${mongoCol}: ${e.message}`),
      );
    const rows = db[jsonKey];
    if (rows && rows.length > 0) {
      const docs = rows.map(convertDates).map((r: any) => {
        // Map 'id' back to '_id' for better-auth so it can natively query these records via ObjectId/String _id
        if (
          r.id &&
          ['user', 'session', 'account', 'verification'].includes(jsonKey)
        ) {
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

  // ── botThread requires special mapping for participantIDs / adminIDs
  await mongoDb
    .collection('botThreads')
    .deleteMany({})
    .catch((e: any) =>
      console.warn(`[WARN] Delete failed for botThreads: ${e.message}`),
    );
  const threadRows = db.botThread;
  if (threadRows && threadRows.length > 0) {
    const threads = threadRows.map((t) => {
      const { participants, admins, ...rest } = t;
      return convertDates({
        ...rest,
        participantIDs: participants || [],
        adminIDs: admins || [],
      });
    });
    try {
      await mongoDb.collection('botThreads').insertMany(threads);
    } catch (e: any) {
      console.warn(`[WARN] Insert failed for botThreads: ${e.message}`);
    }
    console.log(`  ${'botThread'.padEnd(34)} ${threads.length}`);
  }

  console.log('\nMigration complete.');
  await mongoClient.close();
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
