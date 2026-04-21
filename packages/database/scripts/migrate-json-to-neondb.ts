/**
 * migrate-json-to-neondb
 *
 * Reads every table from database.json and inserts the data into the target
 * PostgreSQL/NeonDB database via pg.Pool.
 *
 * Usage (from packages/database/):
 *   npm run migrate:json-to-neondb
 *
 * Prerequisites:
 *   - Set NEON_DATABASE_URL or DATABASE_URL in your .env file.
 *
 * WARNING: This script TRUNCATES the existing NeonDB tables before importing.
 * Back up your database before running if it contains data you want to keep.
 */
import '../scripts/load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import { pool } from '../adapters/neondb/src/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbRoot = path.resolve(__dirname, '..');
const DB_JSON_FILE = path.resolve(dbRoot, 'database/database.json');

// Mapped exactly in topological insertion order to satisfy PostgreSQL FK constraints.
// cols maps jsonKey -> database snake_case_column_name
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

async function main(): Promise<void> {
  console.log('json-to-neondb migration');

  let raw: string;
  try {
    raw = await fs.readFile(DB_JSON_FILE, 'utf-8');
  } catch {
    console.error(`ERROR: ${DB_JSON_FILE} not found.`);
    process.exit(1);
  }

  const db = JSON.parse(raw) as Record<string, any[]>;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Truncating tables...');
    try {
      // Cascade handles FK hierarchies automatically.
      await client.query(
        `TRUNCATE TABLE "user", bot_users, bot_threads, system_admin CASCADE`,
      );
    } catch (e: any) {
      console.warn(`[WARN] Truncate failed: ${e.message}`);
    }

    console.log('Inserting data...');

    for (const def of tables) {
      const rows = db[def.jsonKey] || [];
      if (!rows.length) continue;

      const colNames = Object.values(def.cols);
      const jsonKeys = Object.keys(def.cols);

      // Insert in batches of 100 to avoid hitting query parameter limits
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
            // Convert objects/arrays to stringified JSON if they are meant for TEXT fields
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

        const query = `INSERT INTO ${def.table} (${colNames.join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;
        try {
          await client.query('SAVEPOINT batch_insert');
          await client.query(query, values);
          await client.query('RELEASE SAVEPOINT batch_insert');
        } catch (e: any) {
          await client.query('ROLLBACK TO SAVEPOINT batch_insert');
          console.warn(`[WARN] Insert failed for ${def.table}: ${e.message}`);
        }
      }
      console.log(`  ${def.jsonKey.padEnd(34)} ${rows.length}`);

      // Handle the manual M:M junction tables for botThread
      if (def.jsonKey === 'botThread') {
        const participantsData = [];
        const adminsData = [];
        for (const t of rows) {
          for (const p of t.participants || [])
            participantsData.push({ thread_id: t.id, user_id: p });
          for (const a of t.admins || [])
            adminsData.push({ thread_id: t.id, user_id: a });
        }

        if (participantsData.length > 0) {
          const pValues = participantsData
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
        if (adminsData.length > 0) {
          const aValues = adminsData
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
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
