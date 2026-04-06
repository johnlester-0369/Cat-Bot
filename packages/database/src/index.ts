import 'dotenv/config';

import * as p_cmds from '../adapters/prisma-sqlite/src/cat-bot/bot-session-commands.repo.js';
import * as j_cmds from '../adapters/json/src/cat-bot/bot-session-commands.repo.js';

import * as p_evt from '../adapters/prisma-sqlite/src/cat-bot/bot-session-events.repo.js';
import * as j_evt from '../adapters/json/src/cat-bot/bot-session-events.repo.js';

import * as p_cred from '../adapters/prisma-sqlite/src/cat-bot/credentials.repo.js';
import * as j_cred from '../adapters/json/src/cat-bot/credentials.repo.js';

import * as p_thr from '../adapters/prisma-sqlite/src/cat-bot/threads.repo.js';
import * as j_thr from '../adapters/json/src/cat-bot/threads.repo.js';

import * as p_usr from '../adapters/prisma-sqlite/src/cat-bot/users.repo.js';
import * as j_usr from '../adapters/json/src/cat-bot/users.repo.js';

import * as p_wh from '../adapters/prisma-sqlite/src/cat-bot/webhooks.repo.js';
import * as j_wh from '../adapters/json/src/cat-bot/webhooks.repo.js';

import { botRepo as p_botRepo } from '../adapters/prisma-sqlite/src/server/bot.repo.js';
import { botRepo as j_botRepo } from '../adapters/json/src/server/bot.repo.js';

// Determine operational adapter
const isJson = process.env['DATABASE_TYPE'] === 'json';

// --- BOT SESSION COMMANDS ---
export const upsertSessionCommands: typeof p_cmds.upsertSessionCommands = (...args) => isJson ? j_cmds.upsertSessionCommands(...args) : p_cmds.upsertSessionCommands(...args);
export const findSessionCommands: typeof p_cmds.findSessionCommands = (...args) => isJson ? j_cmds.findSessionCommands(...args) : p_cmds.findSessionCommands(...args);
export const setCommandEnabled: typeof p_cmds.setCommandEnabled = (...args) => isJson ? j_cmds.setCommandEnabled(...args) : p_cmds.setCommandEnabled(...args);
export const isCommandEnabled: typeof p_cmds.isCommandEnabled = (...args) => isJson ? j_cmds.isCommandEnabled(...args) : p_cmds.isCommandEnabled(...args);

// --- BOT SESSION EVENTS ---
export const upsertSessionEvents: typeof p_evt.upsertSessionEvents = (...args) => isJson ? j_evt.upsertSessionEvents(...args) : p_evt.upsertSessionEvents(...args);
export const findSessionEvents: typeof p_evt.findSessionEvents = (...args) => isJson ? j_evt.findSessionEvents(...args) : p_evt.findSessionEvents(...args);
export const setEventEnabled: typeof p_evt.setEventEnabled = (...args) => isJson ? j_evt.setEventEnabled(...args) : p_evt.setEventEnabled(...args);
export const isEventEnabled: typeof p_evt.isEventEnabled = (...args) => isJson ? j_evt.isEventEnabled(...args) : p_evt.isEventEnabled(...args);

// --- CREDENTIALS ---
export const findDiscordCredentialState: typeof p_cred.findDiscordCredentialState = (...args) => isJson ? j_cred.findDiscordCredentialState(...args) : p_cred.findDiscordCredentialState(...args);
export const updateDiscordCredentialCommandHash: typeof p_cred.updateDiscordCredentialCommandHash = (...args) => isJson ? j_cred.updateDiscordCredentialCommandHash(...args) : p_cred.updateDiscordCredentialCommandHash(...args);
export const findAllDiscordCredentials: typeof p_cred.findAllDiscordCredentials = (...args) => isJson ? j_cred.findAllDiscordCredentials(...args) : p_cred.findAllDiscordCredentials(...args);
export const findTelegramCredentialState: typeof p_cred.findTelegramCredentialState = (...args) => isJson ? j_cred.findTelegramCredentialState(...args) : p_cred.findTelegramCredentialState(...args);
export const updateTelegramCredentialCommandHash: typeof p_cred.updateTelegramCredentialCommandHash = (...args) => isJson ? j_cred.updateTelegramCredentialCommandHash(...args) : p_cred.updateTelegramCredentialCommandHash(...args);
export const findAllTelegramCredentials: typeof p_cred.findAllTelegramCredentials = (...args) => isJson ? j_cred.findAllTelegramCredentials(...args) : p_cred.findAllTelegramCredentials(...args);
export const findAllFbPageCredentials: typeof p_cred.findAllFbPageCredentials = (...args) => isJson ? j_cred.findAllFbPageCredentials(...args) : p_cred.findAllFbPageCredentials(...args);
export const findAllFbMessengerCredentials: typeof p_cred.findAllFbMessengerCredentials = (...args) => isJson ? j_cred.findAllFbMessengerCredentials(...args) : p_cred.findAllFbMessengerCredentials(...args);
export const findAllBotSessions: typeof p_cred.findAllBotSessions = (...args) => isJson ? j_cred.findAllBotSessions(...args) : p_cred.findAllBotSessions(...args);
export const isBotAdmin: typeof p_cred.isBotAdmin = (...args) => isJson ? j_cred.isBotAdmin(...args) : p_cred.isBotAdmin(...args);
export const addBotAdmin: typeof p_cred.addBotAdmin = (...args) => isJson ? j_cred.addBotAdmin(...args) : p_cred.addBotAdmin(...args);
export const removeBotAdmin: typeof p_cred.removeBotAdmin = (...args) => isJson ? j_cred.removeBotAdmin(...args) : p_cred.removeBotAdmin(...args);
export const listBotAdmins: typeof p_cred.listBotAdmins = (...args) => isJson ? j_cred.listBotAdmins(...args) : p_cred.listBotAdmins(...args);

// --- THREADS ---
export const upsertThread: typeof p_thr.upsertThread = (...args) => isJson ? j_thr.upsertThread(...args) : p_thr.upsertThread(...args);
export const threadExists: typeof p_thr.threadExists = (...args) => isJson ? j_thr.threadExists(...args) : p_thr.threadExists(...args);
export const threadSessionExists: typeof p_thr.threadSessionExists = (...args) => isJson ? j_thr.threadSessionExists(...args) : p_thr.threadSessionExists(...args);
export const upsertThreadSession: typeof p_thr.upsertThreadSession = (...args) => isJson ? j_thr.upsertThreadSession(...args) : p_thr.upsertThreadSession(...args);
export const isThreadAdmin: typeof p_thr.isThreadAdmin = (...args) => isJson ? j_thr.isThreadAdmin(...args) : p_thr.isThreadAdmin(...args);

// --- USERS ---
export const upsertUser: typeof p_usr.upsertUser = (...args) => isJson ? j_usr.upsertUser(...args) : p_usr.upsertUser(...args);
export const userExists: typeof p_usr.userExists = (...args) => isJson ? j_usr.userExists(...args) : p_usr.userExists(...args);
export const userSessionExists: typeof p_usr.userSessionExists = (...args) => isJson ? j_usr.userSessionExists(...args) : p_usr.userSessionExists(...args);
export const upsertUserSession: typeof p_usr.upsertUserSession = (...args) => isJson ? j_usr.upsertUserSession(...args) : p_usr.upsertUserSession(...args);

// --- WEBHOOKS ---
export const getFbPageWebhookVerification: typeof p_wh.getFbPageWebhookVerification = (...args) => isJson ? j_wh.getFbPageWebhookVerification(...args) : p_wh.getFbPageWebhookVerification(...args);
export const upsertFbPageWebhookVerification: typeof p_wh.upsertFbPageWebhookVerification = (...args) => isJson ? j_wh.upsertFbPageWebhookVerification(...args) : p_wh.upsertFbPageWebhookVerification(...args);

// --- SERVER REPO ---
export const botRepo = isJson ? j_botRepo : p_botRepo;
