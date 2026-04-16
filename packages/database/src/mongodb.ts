/**
 * MongoDB Adapter Barrel
 *
 * Consolidates every export from the mongodb adapter into a single module.
 * This file is ONLY loaded via dynamic import() from src/index.ts when
 * DATABASE_TYPE=mongodb — never import it directly from application code.
 *
 * Keeping it as a static barrel means tsc resolves all types at compile time
 * while the runtime module is skipped entirely when other adapters are active.
 */

// --- BOT SESSION COMMANDS ---
export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from '../adapters/mongodb/src/cat-bot/bot-session-commands.repo.js';

// --- BOT SESSION EVENTS ---
export {
  upsertSessionEvents,
  findSessionEvents,
  setEventEnabled,
  isEventEnabled,
} from '../adapters/mongodb/src/cat-bot/bot-session-events.repo.js';

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
} from '../adapters/mongodb/src/cat-bot/credentials.repo.js';

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
} from '../adapters/mongodb/src/cat-bot/threads.repo.js';

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
} from '../adapters/mongodb/src/cat-bot/users.repo.js';

// --- WEBHOOKS ---
export {
  getFbPageWebhookVerification,
  upsertFbPageWebhookVerification,
} from '../adapters/mongodb/src/cat-bot/webhooks.repo.js';

// --- BANNED ---
export {
  banUser,
  unbanUser,
  isUserBanned,
  banThread,
  unbanThread,
  isThreadBanned,
} from '../adapters/mongodb/src/cat-bot/banned.repo.js';

// --- SERVER ---
export { botRepo } from '../adapters/mongodb/src/server/bot.repo.js';

// --- DATABASE INSTANCES ---
// mongoClient — the singleton MongoClient; used by better-auth.lib.ts to pass to mongodbAdapter.
// getMongoDb  — factory returning the Db instance for MONGO_DATABASE_NAME.
export { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';
