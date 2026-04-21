/**
 * migrate-mongodb-to-neondb
 * Direct migration from MongoDB to NeonDB/Postgres.
 */
import './load-env.js';
import { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';
import { pool } from '../adapters/neondb/src/client.js';

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
    botThreadBanned: 'botThreadBanned',
    user: 'user',
    session: 'session',
    account: 'account',
    verification: 'verification',
  },
];

// Deeply traverse objects and convert MongoDB native ObjectIds to 24-character strings
// This ensures relational FK columns (e.g. userId in session table) receive strings
// instead of a serialized BSON object shape `{"_bsontype":"ObjectID","id":"..."}`
function deepConvert(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj;
    if (
      obj._bsontype === 'ObjectID' ||
      (obj.toHexString && typeof obj.toHexString === 'function')
    )
      return obj.toString();
    if (Array.isArray(obj)) return obj.map(deepConvert);
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepConvert(v);
    return out;
  }
  return obj;
}

async function main() {
  console.log(`mongodb-to-neondb migration`);

  const mongoDb = getMongoDb();
  const db: Record<string, any[]> = {};

  console.log('Reading from MongoDB...');
  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    // Fetch full doc to capture native _id mapping from better-auth
    try {
      const docs = await mongoDb.collection(mongoCol).find({}).toArray();
      db[jsonKey] = docs.map((d) => {
        const converted = deepConvert(d);
        if (converted._id && !converted.id) converted.id = converted._id;
        delete converted._id; // Strip to prevent leaking native ObjectIds to NeonDB
        return converted;
      });
    } catch (e: any) {
      console.warn(`[WARN] Skipping ${mongoCol}: ${e.message}`);
      db[jsonKey] = [];
    }
  }
  try {
    const rawThreads = await mongoDb
      .collection('botThreads')
      .find({})
      .toArray();
    db.botThread = rawThreads.map((t) => {
      const converted = deepConvert(t);
      if (converted._id && !converted.id) converted.id = converted._id;
      delete converted._id;
      const { participantIDs, adminIDs, ...rest } = converted;
      return {
        ...rest,
        participants: participantIDs || [],
        admins: adminIDs || [],
      };
    });
  } catch (e: any) {
    console.warn(`[WARN] Skipping botThreads: ${e.message}`);
    db.botThread = [];
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Truncating tables in NeonDB...');
    try {
      await client.query(
        `TRUNCATE TABLE "user", bot_users, bot_threads, system_admin CASCADE`,
      );
    } catch (e: any) {
      console.warn(`[WARN] Truncate failed: ${e.message}`);
    }

    console.log('Writing to NeonDB...');
    for (const def of tablesDef) {
      const rows = db[def.jsonKey] || [];
      if (!rows.length) continue;

      const colNames = Object.values(def.cols);
      const jsonKeys = Object.keys(def.cols);

      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const placeholders = [];
        const values = [];
        let pIndex = 1;

        for (const row of batch) {
          const rowPlaceholders = [];
          for (const key of jsonKeys) {
            rowPlaceholders.push(`$${pIndex++}`);
            let val = row[key] ?? null;
            if (
              typeof val === 'object' &&
              val !== null &&
              !Array.isArray(val) &&
              !(val instanceof Date)
            ) {
              val = JSON.stringify(val);
            }
            values.push(val);
          }
          placeholders.push(`(${rowPlaceholders.join(', ')})`);
        }
        try {
          await client.query('SAVEPOINT batch_insert');
          await client.query(
            `INSERT INTO ${def.table} (${colNames.join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
            values,
          );
          await client.query('RELEASE SAVEPOINT batch_insert');
        } catch (e: any) {
          await client.query('ROLLBACK TO SAVEPOINT batch_insert');
          console.warn(`[WARN] Insert failed for ${def.table}: ${e.message}`);
        }
      }
      console.log(`  ${def.jsonKey.padEnd(34)} ${rows.length}`);

      if (def.jsonKey === 'botThread') {
        const pData = [],
          aData = [];
        for (const t of rows) {
          for (const p of t.participants || [])
            pData.push({ thread_id: t.id, user_id: p });
          for (const a of t.admins || [])
            aData.push({ thread_id: t.id, user_id: a });
        }
        if (pData.length > 0) {
          const pValues = pData
            .map((p) => `('${p.thread_id}', '${p.user_id}')`)
            .join(', ');
          try {
            await client.query('SAVEPOINT p_insert');
            await client.query(
              `INSERT INTO bot_thread_participants (thread_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
            );
            await client.query('RELEASE SAVEPOINT p_insert');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT p_insert');
            console.warn(`[WARN] ${e.message}`);
          }
        }
        if (aData.length > 0) {
          const aValues = aData
            .map((a) => `('${a.thread_id}', '${a.user_id}')`)
            .join(', ');
          try {
            await client.query('SAVEPOINT a_insert');
            await client.query(
              `INSERT INTO bot_thread_admins (thread_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
            );
            await client.query('RELEASE SAVEPOINT a_insert');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT a_insert');
            console.warn(`[WARN] ${e.message}`);
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log('\nMigration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
    await mongoClient.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
