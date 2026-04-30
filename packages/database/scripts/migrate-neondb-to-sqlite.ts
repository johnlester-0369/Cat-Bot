/**
 * migrate-neondb-to-sqlite
 * Direct migration from NeonDB/Postgres to Prisma/SQLite.
 */
import './load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool, initDb } from '../adapters/neondb/src/client.js';
import { PrismaClient } from '../adapters/prisma-sqlite/src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows<T>(db: Record<string, any[]>, key: string): T[] {
  return (db[key] ?? []) as T[];
}

async function main() {
  console.log(`neondb-to-sqlite migration`);
  console.log(`  Target : ${DB_SQLITE_FILE}`);

  // Ensure NeonDB tables exist before reading
  await initDb();

  const client = await pool.connect();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any[]> = {};

  // ── Phase 1: Read all rows from NeonDB
  console.log('Reading from NeonDB...');
  try {
    for (const def of tablesDef) {
      try {
        const sqlCols = Object.values(def.cols).join(', ');
        const result = await client.query(`SELECT ${sqlCols} FROM ${def.table}`);
        db[def.jsonKey] = result.rows.map((r) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Resolve M:M mapping for botThreads using junction tables
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
    for (const t of threads) threadMap.set(t.id, { ...t, participants: [], admins: [] });
    for (const p of participantsData.rows) threadMap.get(p.thread_id)?.participants.push(p.user_id);
    for (const a of adminsData.rows) threadMap.get(a.thread_id)?.admins.push(a.user_id);
    db.botThread = Array.from(threadMap.values());

    // Resolve M:M mapping for botDiscordServers using junction tables
    const servers = db.botDiscordServer || [];
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
    const serverMap = new Map();
    for (const t of servers) serverMap.set(t.id, { ...t, participants: [], admins: [] });
    for (const p of dsParticipantsData.rows) serverMap.get(p.server_id)?.participants.push(p.user_id);
    for (const a of dsAdminsData.rows) serverMap.get(a.server_id)?.admins.push(a.user_id);
    db.botDiscordServer = Array.from(serverMap.values());
  } finally {
    client.release();
    await pool.end();
  }

  // ── Phase 2: Insert into SQLite in topological order
  const adapter = new PrismaBetterSqlite3({ url: `file:${DB_SQLITE_FILE}` });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter } as any);

  const safeExec = async <T>(p: Promise<T>): Promise<void> => {
    try {
      await p;
    } catch (e: any) {
      console.warn(`[WARN] ${e.message}`);
    }
  };

  console.log('Clearing existing SQLite data...');
  // Delete all records in safe topological order to satisfy SQLite FK constraints
  await safeExec(prisma.botUserBanned.deleteMany());
  await safeExec(prisma.botThreadBanned.deleteMany());
  await safeExec(prisma.botSessionCommand.deleteMany());
  await safeExec(prisma.botSessionEvent.deleteMany());
  await safeExec(prisma.botUserSession.deleteMany());
  await safeExec(prisma.botThreadSession.deleteMany());
  await safeExec(prisma.botDiscordChannel.deleteMany());
  await safeExec(prisma.botDiscordServerSession.deleteMany());
  await safeExec(prisma.botDiscordServer.deleteMany());
  await safeExec(prisma.fbPageWebhook.deleteMany());
  await safeExec(prisma.botCredentialDiscord.deleteMany());
  await safeExec(prisma.botCredentialTelegram.deleteMany());
  await safeExec(prisma.botCredentialFacebookPage.deleteMany());
  await safeExec(prisma.botCredentialFacebookMessenger.deleteMany());
  await safeExec(prisma.botAdmin.deleteMany());
  await safeExec(prisma.botPremium.deleteMany());
  await safeExec(prisma.botSession.deleteMany());
  await safeExec(prisma.botThread.deleteMany());
  await safeExec(prisma.botUser.deleteMany());
  await safeExec(prisma.verification.deleteMany());
  await safeExec(prisma.account.deleteMany());
  await safeExec(prisma.session.deleteMany());
  await safeExec(prisma.user.deleteMany());
  await safeExec(prisma.systemAdmin.deleteMany());

  console.log('Writing to SQLite...');
  if (db.user?.length) await safeExec(prisma.user.createMany({ data: rows(db, 'user') }));
  if (db.session?.length) await safeExec(prisma.session.createMany({ data: rows(db, 'session') }));
  if (db.account?.length) await safeExec(prisma.account.createMany({ data: rows(db, 'account') }));
  if (db.verification?.length) await safeExec(prisma.verification.createMany({ data: rows(db, 'verification') }));
  if (db.systemAdmin?.length) await safeExec(prisma.systemAdmin.createMany({ data: rows(db, 'systemAdmin') }));
  if (db.botUser?.length) await safeExec(prisma.botUser.createMany({ data: rows(db, 'botUser') }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of rows<any>(db, 'botThread')) {
    const { participants = [], admins = [], ...threadScalars } = t;
    await safeExec(
      prisma.botThread.create({
        data: {
          ...threadScalars,
          participants: participants.length
            ? { connect: participants.map((id: string) => ({ id })) }
            : undefined,
          admins: admins.length
            ? { connect: admins.map((id: string) => ({ id })) }
            : undefined,
        },
      }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of rows<any>(db, 'botDiscordServer')) {
    const { participants = [], admins = [], ...serverScalars } = s;
    await safeExec(
      prisma.botDiscordServer.create({
        data: {
          ...serverScalars,
          participants: participants.length
            ? { connect: participants.map((id: string) => ({ id })) }
            : undefined,
          admins: admins.length
            ? { connect: admins.map((id: string) => ({ id })) }
            : undefined,
        },
      }),
    );
  }

  if (db.botDiscordChannel?.length) await safeExec(prisma.botDiscordChannel.createMany({ data: rows(db, 'botDiscordChannel') }));
  if (db.botDiscordServerSession?.length) await safeExec(prisma.botDiscordServerSession.createMany({ data: rows(db, 'botDiscordServerSession') }));

  if (db.botSession?.length) await safeExec(prisma.botSession.createMany({ data: rows(db, 'botSession') }));
  if (db.botAdmin?.length) await safeExec(prisma.botAdmin.createMany({ data: rows(db, 'botAdmin') }));
  if (db.botPremium?.length) await safeExec(prisma.botPremium.createMany({ data: rows(db, 'botPremium') }));

  if (db.botCredentialDiscord?.length) await safeExec(prisma.botCredentialDiscord.createMany({ data: rows(db, 'botCredentialDiscord') }));
  if (db.botCredentialTelegram?.length) await safeExec(prisma.botCredentialTelegram.createMany({ data: rows(db, 'botCredentialTelegram') }));
  if (db.botCredentialFacebookPage?.length) await safeExec(prisma.botCredentialFacebookPage.createMany({ data: rows(db, 'botCredentialFacebookPage') }));
  if (db.botCredentialFacebookMessenger?.length) await safeExec(prisma.botCredentialFacebookMessenger.createMany({ data: rows(db, 'botCredentialFacebookMessenger') }));

  if (db.botUserSession?.length) await safeExec(prisma.botUserSession.createMany({ data: rows(db, 'botUserSession') }));
  if (db.botThreadSession?.length) await safeExec(prisma.botThreadSession.createMany({ data: rows(db, 'botThreadSession') }));
  if (db.fbPageWebhook?.length) await safeExec(prisma.fbPageWebhook.createMany({ data: rows(db, 'fbPageWebhook') }));
  if (db.botSessionCommand?.length) await safeExec(prisma.botSessionCommand.createMany({ data: rows(db, 'botSessionCommand') }));
  if (db.botSessionEvent?.length) await safeExec(prisma.botSessionEvent.createMany({ data: rows(db, 'botSessionEvent') }));

  if (db.botUserBanned?.length) {
    await safeExec(
      prisma.botUserBanned.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: db.botUserBanned.map((r: any) => ({
          ...r,
          reason: r.reason ?? null,
        })),
      }),
    );
  }
  if (db.botThreadBanned?.length) {
    await safeExec(
      prisma.botThreadBanned.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: db.botThreadBanned.map((r: any) => ({
          ...r,
          reason: r.reason ?? null,
        })),
      }),
    );
  }

  console.log('\nMigration complete. Row counts:');
  for (const [table, tableRows] of Object.entries(db)) {
    if (tableRows.length > 0) {
      console.log(`  ${table.padEnd(34)} ${tableRows.length}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
