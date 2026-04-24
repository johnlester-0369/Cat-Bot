/**
 * NeonDB Adapter Barrel
 *
 * Consolidates every export from the neondb adapter into a single module.
 * This file is ONLY loaded via dynamic import() from src/index.ts when
 * DATABASE_TYPE=neondb — never import it directly from application code.
 *
 * better-auth integration: the exported `pool` is a standard pg.Pool instance.
 * better-auth.lib.ts passes it directly to betterAuth({ database: pool }) which
 * uses Kysely's PostgresDialect internally — no additional adapter wiring required.
 */

// --- BOT SESSION COMMANDS ---
export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from '../adapters/neondb/src/cat-bot/bot-session-commands.repo.js';

// --- BOT SESSION EVENTS ---
export {
  upsertSessionEvents,
  findSessionEvents,
  setEventEnabled,
  isEventEnabled,
} from '../adapters/neondb/src/cat-bot/bot-session-events.repo.js';

// --- CREDENTIALS ---
export {
  findDiscordCredentialState,
  updateDiscordCredentialCommandHash,
  findAllDiscordCredentials,
  findTelegramCredentialState,
  updateTelegramCredentialCommandHash,
  findAllTelegramCredentials,
  findAllFbPageCredentials,
  findAllFbMessengerCredentials,
  findAllBotSessions,
  isBotAdmin,
  addBotAdmin,
  removeBotAdmin,
  listBotAdmins,
  updateBotSessionPrefix,
  getBotNickname,
  isBotPremium,
  addBotPremium,
  removeBotPremium,
  listBotPremiums,
  getBotSessionData,
  setBotSessionData,
} from '../adapters/neondb/src/cat-bot/credentials.repo.js';

// --- THREADS ---
export {
  upsertThread,
  threadExists,
  threadSessionExists,
  upsertThreadSession,
  isThreadAdmin,
  getThreadName,
  getThreadSessionData,
  setThreadSessionData,
  getAllGroupThreadIds,
  getThreadSessionUpdatedAt,
  upsertDiscordServer,
  linkDiscordChannel,
  getDiscordServerIdByChannel,
  upsertDiscordServerSession,
  getDiscordServerSessionUpdatedAt,
  getDiscordServerSessionData,
  setDiscordServerSessionData,
  isDiscordServerAdmin,
  getDiscordServerName,
  getAllDiscordServerIds,
  discordServerExists,
  discordServerSessionExists,
} from '../adapters/neondb/src/cat-bot/threads.repo.js';

// --- USERS ---
export {
  upsertUser,
  userExists,
  userSessionExists,
  upsertUserSession,
  getUserName,
  getUserSessionData,
  setUserSessionData,
  getAllUserSessionData,
  getUserSessionUpdatedAt,
} from '../adapters/neondb/src/cat-bot/users.repo.js';

// --- WEBHOOKS ---
export {
  getFbPageWebhookVerification,
  upsertFbPageWebhookVerification,
} from '../adapters/neondb/src/cat-bot/webhooks.repo.js';

// --- BANNED ---
export {
  banUser,
  unbanUser,
  isUserBanned,
  banThread,
  unbanThread,
  isThreadBanned,
} from '../adapters/neondb/src/cat-bot/banned.repo.js';

// --- SERVER ---
export { botRepo } from '../adapters/neondb/src/server/bot.repo.js';

// --- POOL ---
// pool is the pg.Pool singleton — exported so better-auth.lib.ts can pass it directly
// to betterAuth({ database: pool }) without any additional adapter configuration.
// dbReady is the Promise<void> that resolves when initDb() DDL has completed.
export { pool, initDb, dbReady } from '../adapters/neondb/src/client.js';

// --- SYSTEM ADMIN ---
export {
  listSystemAdmins,
  addSystemAdmin,
  removeSystemAdmin,
  isSystemAdmin,
} from '../adapters/neondb/src/server/system-admin.repo.js';
