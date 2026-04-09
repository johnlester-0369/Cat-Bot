// Load .env before any process.env access — DATABASE_TYPE must be readable before the adapter is selected.
import 'dotenv/config';

// Dynamic import defers module resolution entirely to runtime:
//   DATABASE_TYPE=json  → prisma-sqlite.ts (and @prisma/client) is NEVER evaluated. Safe without Prisma installed.
//   DATABASE_TYPE unset → json.ts is NEVER evaluated.
// No `import type` from either barrel — any compile-time type reference to prisma-sqlite.ts
// would force tsc to chase into the generated Prisma files, crashing when they don't exist.
const isJson = process.env['DATABASE_TYPE'] === 'json';
console.log
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (await (isJson ? import('./json.js') : import('./prisma-sqlite.js'))) as any;

// --- BOT SESSION COMMANDS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertSessionCommands = m.upsertSessionCommands;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findSessionCommands   = m.findSessionCommands;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setCommandEnabled     = m.setCommandEnabled;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isCommandEnabled      = m.isCommandEnabled;

// --- BOT SESSION EVENTS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertSessionEvents = m.upsertSessionEvents;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findSessionEvents   = m.findSessionEvents;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setEventEnabled     = m.setEventEnabled;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isEventEnabled      = m.isEventEnabled;

// --- CREDENTIALS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findDiscordCredentialState          = m.findDiscordCredentialState;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const updateDiscordCredentialCommandHash  = m.updateDiscordCredentialCommandHash;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllDiscordCredentials           = m.findAllDiscordCredentials;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findTelegramCredentialState         = m.findTelegramCredentialState;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const updateTelegramCredentialCommandHash = m.updateTelegramCredentialCommandHash;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllTelegramCredentials          = m.findAllTelegramCredentials;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllFbPageCredentials            = m.findAllFbPageCredentials;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllFbMessengerCredentials       = m.findAllFbMessengerCredentials;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllBotSessions                  = m.findAllBotSessions;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isBotAdmin                          = m.isBotAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const addBotAdmin                         = m.addBotAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const removeBotAdmin                      = m.removeBotAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const listBotAdmins                       = m.listBotAdmins;

// --- THREADS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertThread        = m.upsertThread;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const threadExists        = m.threadExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const threadSessionExists = m.threadSessionExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertThreadSession = m.upsertThreadSession;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isThreadAdmin       = m.isThreadAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getThreadName       = m.getThreadName;

// --- USERS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertUser        = m.upsertUser;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const userExists        = m.userExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const userSessionExists = m.userSessionExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertUserSession = m.upsertUserSession;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserName       = m.getUserName;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserSessionData = m.getUserSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setUserSessionData = m.setUserSessionData;

// --- WEBHOOKS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getFbPageWebhookVerification    = m.getFbPageWebhookVerification;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertFbPageWebhookVerification = m.upsertFbPageWebhookVerification;

// --- SERVER REPO ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const botRepo = m.botRepo;

// --- DATABASE INSTANCES ---
// prisma is undefined at runtime when DATABASE_TYPE=json — callers (better-auth.lib.ts)
// already guard with their own isJson check before using it.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const prisma = m.prisma;

// getDb/saveDb are undefined at runtime when DATABASE_TYPE!=json — only used by
// better-auth-adapter.lib.ts which is only instantiated when isJson=true.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getDb  = m.getDb;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const saveDb = m.saveDb;

// --- BANNED ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const banUser        = m.banUser;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const unbanUser      = m.unbanUser;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isUserBanned   = m.isUserBanned;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const banThread      = m.banThread;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const unbanThread    = m.unbanThread;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isThreadBanned = m.isThreadBanned;
