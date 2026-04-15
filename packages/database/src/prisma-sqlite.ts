/**
 * Prisma-SQLite Adapter Barrel
 *
 * Consolidates every export from the prisma-sqlite adapter into a single module.
 * This file is ONLY loaded via dynamic import() from src/index.ts when
 * DATABASE_TYPE is absent or not 'json' — never import it directly.
 *
 * Re-exporting via the adapter's own index.ts (which re-exports the generated
 * Prisma client) means ALL generated model types (BotUser, BotSession,
 * BotCredentialDiscord, etc.) flow through to database package consumers via
 * the `export type *` in src/index.ts — zero additional wiring required.
 */

// --- BOT SESSION COMMANDS ---
export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from '../adapters/prisma-sqlite/src/cat-bot/bot-session-commands.repo.js';

// --- BOT SESSION EVENTS ---
export {
  upsertSessionEvents,
  findSessionEvents,
  setEventEnabled,
  isEventEnabled,
} from '../adapters/prisma-sqlite/src/cat-bot/bot-session-events.repo.js';

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
} from '../adapters/prisma-sqlite/src/cat-bot/credentials.repo.js';

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
} from '../adapters/prisma-sqlite/src/cat-bot/threads.repo.js';

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
} from '../adapters/prisma-sqlite/src/cat-bot/users.repo.js';

// --- WEBHOOKS ---
export {
  getFbPageWebhookVerification,
  upsertFbPageWebhookVerification,
} from '../adapters/prisma-sqlite/src/cat-bot/webhooks.repo.js';

// --- BANNED ---
export {
  banUser,
  unbanUser,
  isUserBanned,
  banThread,
  unbanThread,
  isThreadBanned,
} from '../adapters/prisma-sqlite/src/cat-bot/banned.repo.js';

// --- SERVER ---
export { botRepo } from '../adapters/prisma-sqlite/src/server/bot.repo.js';

// --- DATABASE INSTANCES + GENERATED TYPES ---
// Re-exporting via the adapter's own index gives us:
//   prisma  — the singleton PrismaClient (used by better-auth and internal repos)
//   *       — every generated model type (BotUser, BotSession, PrismaClient class, ...)
// Consumers of the 'database' package gain full Prisma type safety through this single line.
export * from '../adapters/prisma-sqlite/src/index.js';
