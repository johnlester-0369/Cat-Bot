/**
 * Json Adapter Barrel
 *
 * Consolidates every export from the json flat-file adapter into a single module.
 * This file is ONLY loaded via dynamic import() from src/index.ts when
 * DATABASE_TYPE=json — never import it directly from application code.
 *
 * Keeping it as a static barrel means tsc resolves all types at compile time
 * while the runtime module is skipped entirely when the prisma-sqlite adapter is active.
 */

// --- BOT SESSION COMMANDS ---
export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from '../adapters/json/src/cat-bot/bot-session-commands.repo.js';

// --- BOT SESSION EVENTS ---
export {
  upsertSessionEvents,
  findSessionEvents,
  setEventEnabled,
  isEventEnabled,
} from '../adapters/json/src/cat-bot/bot-session-events.repo.js';

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
} from '../adapters/json/src/cat-bot/credentials.repo.js';

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
} from '../adapters/json/src/cat-bot/threads.repo.js';

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
} from '../adapters/json/src/cat-bot/users.repo.js';

// --- WEBHOOKS ---
export {
  getFbPageWebhookVerification,
  upsertFbPageWebhookVerification,
} from '../adapters/json/src/cat-bot/webhooks.repo.js';

// --- BANNED ---
export {
  banUser,
  unbanUser,
  isUserBanned,
  banThread,
  unbanThread,
  isThreadBanned,
} from '../adapters/json/src/cat-bot/banned.repo.js';

// --- SERVER ---
export { botRepo } from '../adapters/json/src/server/bot.repo.js';

// --- STORE (better-auth json adapter + direct consumers) ---
export { getDb, saveDb } from '../adapters/json/src/store.js';
