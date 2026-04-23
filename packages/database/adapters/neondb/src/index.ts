// Single import point for all consumers in the monorepo.
// This file is the adapter barrel — only the database package's src/neondb.ts imports from here.
// Application code always imports from 'database', never from this adapter directly.
export { pool, initDb, dbReady } from './client.js';

export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from './cat-bot/bot-session-commands.repo.js';

export {
  upsertSessionEvents,
  findSessionEvents,
  setEventEnabled,
  isEventEnabled,
} from './cat-bot/bot-session-events.repo.js';

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
} from './cat-bot/credentials.repo.js';

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
  // Discord server-isolated storage — channel ID maps to server ID so settings and data
  // are stored at the Guild level rather than duplicated across every channel row.
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
} from './cat-bot/threads.repo.js';

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
} from './cat-bot/users.repo.js';

export {
  getFbPageWebhookVerification,
  upsertFbPageWebhookVerification,
} from './cat-bot/webhooks.repo.js';

export {
  banUser,
  unbanUser,
  isUserBanned,
  banThread,
  unbanThread,
  isThreadBanned,
} from './cat-bot/banned.repo.js';

export { botRepo } from './server/bot.repo.js';

export {
  listSystemAdmins,
  addSystemAdmin,
  removeSystemAdmin,
  isSystemAdmin,
} from './server/system-admin.repo.js';
