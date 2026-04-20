/**
 * migrate-mongodb-to-json
 *
 * Reads every collection from the target MongoDB database and writes a
 * fully-populated database.json in the format expected by the JSON adapter.
 *
 * Usage (from packages/database/):
 *   npm run migrate:mongodb-to-json
 *
 * Prerequisites:
 *   - Set MONGODB_URI and MONGO_DATABASE_NAME in your .env file.
 *
 * Safety: this script is read-only against MongoDB and overwrites database.json.
 */
import '../scripts/load-env.js';
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

function deepConvert(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj;
    if (obj._bsontype === 'ObjectID' || (obj.toHexString && typeof obj.toHexString === 'function')) return obj.toString();
    if (Array.isArray(obj)) return obj.map(deepConvert);
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepConvert(v);
    return out;
  }
  return obj;
}

async function main(): Promise<void> {
  console.log('mongodb-to-json migration');
  console.log(`  Output : ${DB_JSON_FILE}`);
  
  const mongoDb = getMongoDb();
  const outDb: Record<string, any[]> = {};

  console.log('\nReading collections from MongoDB...');

  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    // Strip native MongoDB _id to match JSON schema exactly
    // We map d._id to d.id before deleting it so better-auth string keys aren't lost
    try {
      const docs = await mongoDb.collection(mongoCol).find({}).toArray();
      outDb[jsonKey] = docs.map((d) => {
        const converted = deepConvert(d);
        if (converted._id && !converted.id) converted.id = converted._id;
        delete converted._id;
        return converted;
      });
    } catch (e: any) {
      console.warn(`[WARN] Skipping ${mongoCol}: ${e.message}`);
      outDb[jsonKey] =[];
    }
  }

  // ── botThread requires mapping participantIDs -> participants
  try {
    const threads = await mongoDb.collection('botThreads').find({}).toArray();
    outDb.botThread = threads.map((t) => {
      const converted = deepConvert(t);
      if (converted._id && !converted.id) converted.id = converted._id;
      delete converted._id;
      const { participantIDs, adminIDs, ...rest } = converted;
      return {
        ...rest,
        participants: participantIDs || [],
        admins: adminIDs ||[],
      };
    });
  } catch (e: any) {
    console.warn(`[WARN] Skipping botThreads: ${e.message}`);
    outDb.botThread =[];
  }

  await fs.mkdir(path.dirname(DB_JSON_FILE), { recursive: true });
  await fs.writeFile(DB_JSON_FILE, JSON.stringify(outDb, null, 2), 'utf-8');

  console.log('\nMigration complete. Row counts:');
  for (const [table, rows] of Object.entries(outDb)) {
    if (rows.length > 0) {
      console.log(`  ${table.padEnd(34)} ${rows.length}`);
    }
  }
  
  await mongoClient.close();
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
