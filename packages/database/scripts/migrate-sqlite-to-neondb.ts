/**
 * migrate-sqlite-to-neondb
 * Direct migration from Prisma/SQLite to NeonDB/Postgres.
 */
import './load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '../adapters/prisma-sqlite/src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { pool, initDb } from '../adapters/neondb/src/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbRoot = path.resolve(__dirname, '..');

const rawUrl = process.env['SQLITE_DATABASE_URL'] ?? process.env['DATABASE_URL'];
const DB_SQLITE_FILE = rawUrl
  ? rawUrl.replace(/^file:/, '')
  : path.resolve(dbRoot, 'database/database.sqlite');

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

async function main() {
  console.log(`sqlite-to-neondb migration`);
  console.log(`  Source : ${DB_SQLITE_FILE}`);

  // Ensure NeonDB tables exist before proceeding to avoid undefined_table errors
  await initDb();

  const adapter = new PrismaBetterSqlite3({ url: `file:${DB_SQLITE_FILE}` });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter } as any);

  const safeFind = <T>(p: Promise<T>): Promise<T> =>
    p.catch((e: any) => {
      console.warn(`[WARN] ${e.message}`);
      return [] as unknown as T;
    });

  console.log('Reading from SQLite...');
  const [
    user,
    session,
    account,
    verification,
    botSession,
    botAdmin,
    botPremium,
    botDiscordServers,
    botDiscordChannel,
    botDiscordServerSession,
    botCredentialDiscord,
    botCredentialTelegram,
    botCredentialFacebookPage,
    botCredentialFacebookMessenger,
    botUser,
    botThreads,
    botUserSession,
    botThreadSession,
    fbPageWebhook,
    botSessionCommand,
    botSessionEvent,
    botUserBanned,
    botThreadBanned,
    systemAdmin,
  ] = await Promise.all([
    safeFind(prisma.user.findMany()),
    safeFind(prisma.session.findMany()),
    safeFind(prisma.account.findMany()),
    safeFind(prisma.verification.findMany()),
    safeFind(prisma.botSession.findMany()),
    safeFind(prisma.botAdmin.findMany()),
    safeFind(prisma.botPremium.findMany()),
    safeFind(
      prisma.botDiscordServer.findMany({
        include: {
          participants: { select: { id: true } },
          admins: { select: { id: true } },
        },
      }),
    ),
    safeFind(prisma.botDiscordChannel.findMany()),
    safeFind(prisma.botDiscordServerSession.findMany()),
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
    safeFind(prisma.systemAdmin.findMany()),
  ]);

  const botThread = botThreads.map((t) => ({
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

  const botDiscordServer = botDiscordServers.map((s) => ({
    id: s.id,
    name: s.name,
    avatarUrl: s.avatarUrl,
    memberCount: s.memberCount,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    participants: s.participants.map((p) => p.id),
    admins: s.admins.map((a) => a.id),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any[]> = {
    user,
    session,
    account,
    verification,
    botUser,
    botThread,
    botDiscordServer,
    botDiscordChannel,
    botSession,
    botAdmin,
    botPremium,
    botCredentialDiscord,
    botCredentialTelegram,
    botCredentialFacebookPage,
    botCredentialFacebookMessenger,
    botUserSession,
    botThreadSession,
    botDiscordServerSession,
    fbPageWebhook,
    botSessionCommand,
    botSessionEvent,
    botUserBanned,
    botThreadBanned,
    systemAdmin,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Truncating tables in NeonDB...');
    try {
      await client.query(
        `TRUNCATE TABLE "user", bot_users, bot_threads, bot_discord_server, system_admin CASCADE`,
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

      if (def.jsonKey === 'botThread') {
        const participantsData = [];
        const adminsData = [];
        for (const t of rows) {
          for (const p of t.participants || []) participantsData.push({ thread_id: t.id, user_id: p });
          for (const a of t.admins || []) adminsData.push({ thread_id: t.id, user_id: a });
        }

        if (participantsData.length > 0) {
          const pValues = participantsData.map((p) => `('${p.thread_id}', '${p.user_id}')`).join(', ');
          try {
            await client.query('SAVEPOINT p_insert');
            await client.query(`INSERT INTO bot_thread_participants (thread_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`);
            await client.query('RELEASE SAVEPOINT p_insert');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT p_insert');
            console.warn(`[WARN] ${e.message}`);
          }
        }
        if (adminsData.length > 0) {
          const aValues = adminsData.map((a) => `('${a.thread_id}', '${a.user_id}')`).join(', ');
          try {
            await client.query('SAVEPOINT a_insert');
            await client.query(`INSERT INTO bot_thread_admins (thread_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`);
            await client.query('RELEASE SAVEPOINT a_insert');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT a_insert');
            console.warn(`[WARN] ${e.message}`);
          }
        }
      }

      if (def.jsonKey === 'botDiscordServer') {
        const participantsData = [];
        const adminsData = [];
        for (const t of rows) {
          for (const p of t.participants || []) participantsData.push({ server_id: t.id, user_id: p });
          for (const a of t.admins || []) adminsData.push({ server_id: t.id, user_id: a });
        }
        if (participantsData.length > 0) {
          const pValues = participantsData.map((p) => `('${p.server_id}', '${p.user_id}')`).join(', ');
          try {
            await client.query('SAVEPOINT p_insert_ds');
            await client.query(`INSERT INTO bot_discord_server_participants (server_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`);
            await client.query('RELEASE SAVEPOINT p_insert_ds');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT p_insert_ds');
          }
        }
        if (adminsData.length > 0) {
          const aValues = adminsData.map((a) => `('${a.server_id}', '${a.user_id}')`).join(', ');
          try {
            await client.query('SAVEPOINT a_insert_ds');
            await client.query(`INSERT INTO bot_discord_server_admins (server_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`);
            await client.query('RELEASE SAVEPOINT a_insert_ds');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT a_insert_ds');
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
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
