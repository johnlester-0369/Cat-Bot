/**
 * migrate-neondb-to-mongodb
 * Direct migration from NeonDB/Postgres to MongoDB.
 */
import '../scripts/load-env.js';
import { pool } from '../adapters/neondb/src/client.js';
import { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';

const tablesDef = [
  {
    jsonKey: 'user',
    table: '"user"',
    cols: {
      id: 'id',
      name: 'name',
      email: 'email',
      emailVerified: '"emailVerified"',
      image: 'image',
      createdAt: '"createdAt"',
      role: 'role',
      banned: 'banned',
      banReason: '"banReason"',
      banExpires: '"banExpires"',
      updatedAt: '"updatedAt"',
    },
  },
  {
    jsonKey: 'session',
    table: '"session"',
    cols: {
      id: 'id',
      expiresAt: '"expiresAt"',
      token: 'token',
      createdAt: '"createdAt"',
      updatedAt: '"updatedAt"',
      ipAddress: '"ipAddress"',
      userAgent: '"userAgent"',
      impersonatedBy: '"impersonatedBy"',
      userId: '"userId"',
    },
  },
  {
    jsonKey: 'account',
    table: '"account"',
    cols: {
      id: 'id',
      accountId: '"accountId"',
      providerId: '"providerId"',
      userId: '"userId"',
      accessToken: '"accessToken"',
      refreshToken: '"refreshToken"',
      idToken: '"idToken"',
      accessTokenExpiresAt: '"accessTokenExpiresAt"',
      refreshTokenExpiresAt: '"refreshTokenExpiresAt"',
      scope: 'scope',
      password: 'password',
      createdAt: '"createdAt"',
      updatedAt: '"updatedAt"',
    },
  },
  {
    jsonKey: 'verification',
    table: '"verification"',
    cols: {
      id: 'id',
      identifier: 'identifier',
      value: 'value',
      expiresAt: '"expiresAt"',
      createdAt: '"createdAt"',
      updatedAt: '"updatedAt"',
    },
  },
  {
    jsonKey: 'systemAdmin',
    table: 'system_admin',
    cols: { id: 'id', adminId: 'admin_id', createdAt: 'created_at' },
  },
  {
    jsonKey: 'botUser',
    table: 'bot_users',
    cols: {
      platformId: 'platform_id',
      id: 'id',
      name: 'name',
      firstName: 'first_name',
      username: 'username',
      avatarUrl: 'avatar_url',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botThread',
    table: 'bot_threads',
    cols: {
      platformId: 'platform_id',
      id: 'id',
      name: 'name',
      isGroup: 'is_group',
      memberCount: 'member_count',
      avatarUrl: 'avatar_url',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botSession',
    table: 'bot_session',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      nickname: 'nickname',
      prefix: 'prefix',
      isRunning: 'is_running',
    },
  },
  {
    jsonKey: 'botAdmin',
    table: 'bot_admin',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      adminId: 'admin_id',
    },
  },
  {
    jsonKey: 'botPremium',
    table: 'bot_premium',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      premiumId: 'premium_id',
    },
  },
  {
    jsonKey: 'botCredentialDiscord',
    table: 'bot_credential_discord',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      discordToken: 'discord_token',
      discordClientId: 'discord_client_id',
      isCommandRegister: 'is_command_register',
      commandHash: 'command_hash',
    },
  },
  {
    jsonKey: 'botCredentialTelegram',
    table: 'bot_credential_telegram',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      telegramToken: 'telegram_token',
      isCommandRegister: 'is_command_register',
      commandHash: 'command_hash',
    },
  },
  {
    jsonKey: 'botCredentialFacebookPage',
    table: 'bot_credential_facebook_page',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      fbAccessToken: 'fb_access_token',
      fbPageId: 'fb_page_id',
    },
  },
  {
    jsonKey: 'botCredentialFacebookMessenger',
    table: 'bot_credential_facebook_messenger',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      appstate: 'appstate',
    },
  },
  {
    jsonKey: 'fbPageWebhook',
    table: 'fb_page_webhook',
    cols: { userId: 'user_id', isVerified: 'is_verified' },
  },
  {
    jsonKey: 'botUserSession',
    table: 'bot_users_session',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botUserId: 'bot_user_id',
      lastUpdatedAt: 'last_updated_at',
      data: 'data',
    },
  },
  {
    jsonKey: 'botThreadSession',
    table: 'bot_threads_session',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botThreadId: 'bot_thread_id',
      lastUpdatedAt: 'last_updated_at',
      data: 'data',
    },
  },
  {
    jsonKey: 'botSessionCommand',
    table: 'bot_session_commands',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      commandName: 'command_name',
      isEnable: 'is_enable',
    },
  },
  {
    jsonKey: 'botSessionEvent',
    table: 'bot_session_events',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      eventName: 'event_name',
      isEnable: 'is_enable',
    },
  },
  {
    jsonKey: 'botUserBanned',
    table: 'bot_users_session_banned',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botUserId: 'bot_user_id',
      isBanned: 'is_banned',
      reason: 'reason',
    },
  },
  {
    jsonKey: 'botThreadBanned',
    table: 'bot_threads_session_banned',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botThreadId: 'bot_thread_id',
      isBanned: 'is_banned',
      reason: 'reason',
    },
  },
];

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

const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function convertDates(obj: any): any {
  if (typeof obj === 'string' && isoDateRegex.test(obj)) return new Date(obj);
  if (Array.isArray(obj)) return obj.map(convertDates);
  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Date) return obj;
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = convertDates(v);
    return out;
  }
  return obj;
}

async function main() {
  console.log(`neondb-to-mongodb migration`);

  const client = await pool.connect();
  const db: Record<string, any[]> = {};

  console.log('Reading from NeonDB...');
  try {
    for (const def of tablesDef) {
      try {
        const sqlCols = Object.values(def.cols).join(', ');
        const result = await client.query(
          `SELECT ${sqlCols} FROM ${def.table}`,
        );
        db[def.jsonKey] = result.rows.map((r) => {
          const outRow: any = {};
          for (const [jsonKey, rawDbKey] of Object.entries(def.cols)) {
            outRow[jsonKey] = r[rawDbKey.replace(/"/g, '')] ?? null;
          }
          return outRow;
        });
      } catch (e: any) {
        console.warn(`[WARN] Skipping ${def.table}: ${e.message}`);
        db[def.jsonKey] = [];
      }
    }

    const threads = db.botThread || [];
    const participantsData = await client
      .query('SELECT thread_id, user_id FROM bot_thread_participants')
      .catch((e: any) => {
        console.warn(`[WARN] ${e.message}`);
        return { rows: [] };
      });
    const adminsData = await client
      .query('SELECT thread_id, user_id FROM bot_thread_admins')
      .catch((e: any) => {
        console.warn(`[WARN] ${e.message}`);
        return { rows: [] };
      });
    const threadMap = new Map();
    for (const t of threads)
      threadMap.set(t.id, { ...t, participants: [], admins: [] });
    for (const p of participantsData.rows)
      threadMap.get(p.thread_id)?.participants.push(p.user_id);
    for (const a of adminsData.rows)
      threadMap.get(a.thread_id)?.admins.push(a.user_id);
    db.botThread = Array.from(threadMap.values());
  } finally {
    client.release();
    await pool.end();
  }

  const mongoDb = getMongoDb();
  console.log('Writing to MongoDB...');

  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    await mongoDb
      .collection(mongoCol)
      .deleteMany({})
      .catch((e: any) =>
        console.warn(`[WARN] Delete failed for ${mongoCol}: ${e.message}`),
      );
    const rows = db[jsonKey] || [];
    if (rows.length > 0) {
      const docs = rows.map(convertDates).map((r) => {
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

  await mongoDb
    .collection('botThreads')
    .deleteMany({})
    .catch((e: any) =>
      console.warn(`[WARN] Delete failed for botThreads: ${e.message}`),
    );
  const threads = db.botThread;
  if (threads && threads.length > 0) {
    const threadDocs = threads.map((t) => {
      const { participants, admins, ...rest } = t;
      return convertDates({
        ...rest,
        participantIDs: participants || [],
        adminIDs: admins || [],
      });
    });
    try {
      await mongoDb.collection('botThreads').insertMany(threadDocs);
    } catch (e: any) {
      console.warn(`[WARN] Insert failed for botThreads: ${e.message}`);
    }
    console.log(`  ${'botThread'.padEnd(34)} ${threadDocs.length}`);
  }

  console.log('\nMigration complete.');
  await mongoClient.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
