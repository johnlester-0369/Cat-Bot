import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Authoritative table registry — every table the JSON adapter knows about.
// WHY this lives here instead of inside getDb():
//   When database.json was written by an older version of the bot, it only
//   contains the tables that existed at that time. Any table added afterward
//   (e.g. botUserBanned after the initial schema) is simply absent from the
//   parsed object, causing "Cannot read properties of undefined" on the first
//   repo call that accesses the new table.
//   Spreading DEFAULT_DB *under* the parsed content fills missing keys with
//   empty arrays while leaving all existing data completely untouched —
//   zero manual migration required when the schema evolves.
const DEFAULT_DB = {
  botSessionCommand: [],
  botSessionEvent: [],
  botCredentialDiscord: [],
  botCredentialTelegram: [],
  botCredentialFacebookPage: [],
  botCredentialFacebookMessenger: [],
  botSession: [],
  botAdmin: [],
  botPremium: [],
  botThread: [],
  botUser: [],
  fbPageWebhook: [],
  systemAdmin: [],
  botThreadSession: [],
  botUserSession: [],
  botUserBanned: [],
  botThreadBanned: [],
  botDiscordServer: [],
  botDiscordServerSession: [],
  botDiscordChannel: [],
  // better-auth core tables — required when DATABASE_TYPE=json so auth queries
  // find an initialised array instead of undefined on first boot.
  user: [],
  session: [],
  account: [],
  verification: [],
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbRoot = path.resolve(__dirname, '../../..');
// If compiled into dist/database/adapters/..., go up two more levels to exit dist/
if (
  path.basename(dbRoot) === 'database' &&
  path.basename(path.dirname(dbRoot)) === 'dist'
) {
  dbRoot = path.resolve(dbRoot, '../..');
}
const DB_FILE = path.resolve(dbRoot, 'database/database.json');

export let dbCache: any = null;

// WHY: Provides a fast in-memory document store fallback when SQLite is not used.
export const getDb = async () => {
  if (dbCache) return dbCache;
  try {
    const content = await fs.readFile(DB_FILE, 'utf-8');
    // Spread DEFAULT_DB first so any table absent from an older database.json
    // is backfilled with [] — parsed content wins for all keys that already exist.
    dbCache = { ...DEFAULT_DB, ...(JSON.parse(content) as object) };
  } catch {
    dbCache = { ...DEFAULT_DB };
  }
  return dbCache;
};

export const saveDb = async () => {
  if (!dbCache) return;
  await fs.writeFile(DB_FILE, JSON.stringify(dbCache, null, 2));
};
