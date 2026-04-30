/**
 * migrate-neondb-to-json
 *
 * Reads every table from the target PostgreSQL/NeonDB database and writes a
 * fully-populated database.json in the format expected by the JSON adapter.
 *
 * Usage (from packages/database/):
 *   npm run migrate:neondb-to-json
 *
 * Prerequisites:
 *   - Set NEON_DATABASE_URL or DATABASE_URL in your .env file.
 *
 * Safety: this script is read-only against NeonDB and overwrites database.json.
 */
import '../scripts/load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import { pool, initDb } from '../adapters/neondb/src/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbRoot = path.resolve(__dirname, '..');
const DB_JSON_FILE = path.resolve(dbRoot, 'database/database.json');

// Mapped backwards from PostgreSQL column names to the JSON adapter structure.
const tables = [
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
    jsonKey: 'botDiscordServer',
    table: 'bot_discord_server',
    cols: {
      id: 'id',
      name: 'name',
      avatarUrl: 'avatar_url',
      memberCount: 'member_count',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botDiscordChannel',
    table: 'bot_discord_channel',
    cols: { threadId: 'thread_id', serverId: 'server_id' },
  },
  {
    jsonKey: 'botDiscordServerSession',
    table: 'bot_discord_server_session',
    cols: {
      userId: 'user_id',
      sessionId: 'session_id',
      botServerId: 'bot_server_id',
      lastUpdatedAt: 'last_updated_at',
      data: 'data',
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
      data: 'data',
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

async function main(): Promise<void> {
  console.log('neondb-to-json migration');
  console.log(`  Output : ${DB_JSON_FILE}`);

  // Ensure NeonDB tables exist before reading
  await initDb();

  const outDb: Record<string, any[]> = {};
  const client = await pool.connect();

  try {
    console.log('\nReading tables from PostgreSQL...');

    for (const def of tables) {
      const sqlCols = Object.values(def.cols).join(', ');

      let result;
      try {
        result = await client.query(`SELECT ${sqlCols} FROM ${def.table}`);
      } catch (e: any) {
        console.warn(`[WARN] Skipping ${def.table}: ${e.message}`);
        outDb[def.jsonKey] = [];
        continue;
      }

      const mappedRows = result.rows.map((r) => {
        const outRow: any = {};
        for (const [jsonKey, rawDbKey] of Object.entries(def.cols)) {
          const dbKey = rawDbKey.replace(/"/g, '');
          outRow[jsonKey] = r[dbKey] ?? null;
        }
        return outRow;
      });

      outDb[def.jsonKey] = mappedRows;
    }

    // ── Append M:M botThread junctions
    const threads = outDb.botThread || [];

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

    const threadMap = new Map<string, any>();

    // FIX: properly initialize map
    for (const t of threads) {
      threadMap.set(t.id, { ...t, participants: [], admins: [] });
    }

    for (const p of participantsData.rows) {
      const t = threadMap.get(p.thread_id);
      if (t) t.participants.push(p.user_id);
    }

    for (const a of adminsData.rows) {
      const t = threadMap.get(a.thread_id);
      if (t) t.admins.push(a.user_id);
    }

    outDb.botThread = Array.from(threadMap.values());

    // ── Append M:M botDiscordServer junctions
    const servers = outDb.botDiscordServer || [];
    const dsParticipantsData = await client
      .query('SELECT server_id, user_id FROM bot_discord_server_participants')
      .catch((e: any) => {
        console.warn(`[WARN] ${e.message}`);
        return { rows: [] };
      });
    const dsAdminsData = await client
      .query('SELECT server_id, user_id FROM bot_discord_server_admins')
      .catch((e: any) => {
        console.warn(`[WARN] ${e.message}`);
        return { rows: [] };
      });

    const serverMap = new Map<string, any>();
    for (const t of servers) serverMap.set(t.id, { ...t, participants: [], admins: [] });
    for (const p of dsParticipantsData.rows) {
      serverMap.get(p.server_id)?.participants.push(p.user_id);
    }
    for (const a of dsAdminsData.rows) {
      serverMap.get(a.server_id)?.admins.push(a.user_id);
    }
    outDb.botDiscordServer = Array.from(serverMap.values());

    await fs.mkdir(path.dirname(DB_JSON_FILE), { recursive: true });
    await fs.writeFile(DB_JSON_FILE, JSON.stringify(outDb, null, 2), 'utf-8');

    console.log('\nMigration complete. Row counts:');
    for (const [table, rows] of Object.entries(outDb)) {
      if (rows.length > 0) {
        console.log(`  ${table.padEnd(34)} ${rows.length}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
