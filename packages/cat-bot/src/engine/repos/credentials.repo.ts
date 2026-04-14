/**
 * Credentials Repo — LRU cache layer over the database adapter.
 *
 * Credential lookups and admin checks are called at bot startup (findAll*)
 * and on every privileged command invocation (isBotAdmin, listBotAdmins).
 * Caching these eliminates repeated DB reads for data that changes rarely.
 *
 * Invalidation strategy:
 *   - updateDiscordCredentialCommandHash  → clears discord state + all-discord list
 *   - updateTelegramCredentialCommandHash → clears telegram state + all-telegram list
 *   - addBotAdmin / removeBotAdmin        → clears the specific check entry and the list for that session
 *   - updateBotSessionPrefix              → clears the all-sessions list (prefix is a session field)
 */
import {
  findDiscordCredentialState as _findDiscordCredentialState,
  updateDiscordCredentialCommandHash as _updateDiscordCredentialCommandHash,
  findAllDiscordCredentials as _findAllDiscordCredentials,
  findTelegramCredentialState as _findTelegramCredentialState,
  updateTelegramCredentialCommandHash as _updateTelegramCredentialCommandHash,
  findAllTelegramCredentials as _findAllTelegramCredentials,
  findAllFbPageCredentials as _findAllFbPageCredentials,
  findAllFbMessengerCredentials as _findAllFbMessengerCredentials,
  findAllBotSessions as _findAllBotSessions,
  isBotAdmin as _isBotAdmin,
  addBotAdmin as _addBotAdmin,
  removeBotAdmin as _removeBotAdmin,
  listBotAdmins as _listBotAdmins,
  updateBotSessionPrefix as _updateBotSessionPrefix,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key builders ────────────────────────────────────────────────────────

const discordStateKey = (userId: string, sessionId: string): string =>
  `cred:discord:state:${userId}:${sessionId}`;

const telegramStateKey = (userId: string, sessionId: string): string =>
  `cred:telegram:state:${userId}:${sessionId}`;

const adminCheckKey = (
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): string => `admin:check:${userId}:${platform}:${sessionId}:${adminId}`;

const adminListKey = (userId: string, platform: string, sessionId: string): string =>
  `admin:list:${userId}:${platform}:${sessionId}`;

// Singleton keys for aggregate credential/session lists that contain all rows.
const DISCORD_ALL_KEY = 'cred:discord:all';
const TELEGRAM_ALL_KEY = 'cred:telegram:all';
const FBPAGE_ALL_KEY = 'cred:fbpage:all';
const FBMESSENGER_ALL_KEY = 'cred:fbmessenger:all';
// Shared with server/repos/bot.repo.ts — both repos invalidate this key on session mutations
// so session-loader always receives an up-to-date list on the next findAllBotSessions call.
export const SESSIONS_ALL_KEY = 'cred:sessions:all';

// ── Discord ───────────────────────────────────────────────────────────────────

export async function findDiscordCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const key = discordStateKey(userId, sessionId);
  const cached = lruCache.get<Awaited<ReturnType<typeof _findDiscordCredentialState>>>(key);
  if (cached !== undefined) return cached;
  const result = await _findDiscordCredentialState(userId, sessionId);
  lruCache.set(key, result);
  return result;
}

export async function updateDiscordCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: Parameters<typeof _updateDiscordCredentialCommandHash>[2],
): Promise<void> {
  await _updateDiscordCredentialCommandHash(userId, sessionId, data);
  // The state cache includes commandHash/isCommandRegister; the all-list also embeds these
  // fields — both must be cleared so the next read reflects the freshly registered commands.
  lruCache.del(discordStateKey(userId, sessionId));
  lruCache.del(DISCORD_ALL_KEY);
}

export async function findAllDiscordCredentials(): Promise<
  Awaited<ReturnType<typeof _findAllDiscordCredentials>>
> {
  const cached = lruCache.get<Awaited<ReturnType<typeof _findAllDiscordCredentials>>>(DISCORD_ALL_KEY);
  if (cached !== undefined) return cached;
  const result = await _findAllDiscordCredentials();
  lruCache.set(DISCORD_ALL_KEY, result);
  return result;
}

// ── Telegram ──────────────────────────────────────────────────────────────────

export async function findTelegramCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const key = telegramStateKey(userId, sessionId);
  const cached = lruCache.get<Awaited<ReturnType<typeof _findTelegramCredentialState>>>(key);
  if (cached !== undefined) return cached;
  const result = await _findTelegramCredentialState(userId, sessionId);
  lruCache.set(key, result);
  return result;
}

export async function updateTelegramCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: Parameters<typeof _updateTelegramCredentialCommandHash>[2],
): Promise<void> {
  await _updateTelegramCredentialCommandHash(userId, sessionId, data);
  lruCache.del(telegramStateKey(userId, sessionId));
  lruCache.del(TELEGRAM_ALL_KEY);
}

export async function findAllTelegramCredentials(): Promise<
  Awaited<ReturnType<typeof _findAllTelegramCredentials>>
> {
  const cached = lruCache.get<Awaited<ReturnType<typeof _findAllTelegramCredentials>>>(TELEGRAM_ALL_KEY);
  if (cached !== undefined) return cached;
  const result = await _findAllTelegramCredentials();
  lruCache.set(TELEGRAM_ALL_KEY, result);
  return result;
}

// ── Facebook Page ──────────────────────────────────────────────────────────────

export async function findAllFbPageCredentials(): Promise<
  Awaited<ReturnType<typeof _findAllFbPageCredentials>>
> {
  const cached = lruCache.get<Awaited<ReturnType<typeof _findAllFbPageCredentials>>>(FBPAGE_ALL_KEY);
  if (cached !== undefined) return cached;
  const result = await _findAllFbPageCredentials();
  lruCache.set(FBPAGE_ALL_KEY, result);
  return result;
}

// ── Facebook Messenger ────────────────────────────────────────────────────────

export async function findAllFbMessengerCredentials(): Promise<
  Awaited<ReturnType<typeof _findAllFbMessengerCredentials>>
> {
  const cached = lruCache.get<Awaited<ReturnType<typeof _findAllFbMessengerCredentials>>>(FBMESSENGER_ALL_KEY);
  if (cached !== undefined) return cached;
  const result = await _findAllFbMessengerCredentials();
  lruCache.set(FBMESSENGER_ALL_KEY, result);
  return result;
}

// ── Bot Sessions ──────────────────────────────────────────────────────────────

export async function findAllBotSessions(): Promise<
  Awaited<ReturnType<typeof _findAllBotSessions>>
> {
  const cached = lruCache.get<Awaited<ReturnType<typeof _findAllBotSessions>>>(SESSIONS_ALL_KEY);
  if (cached !== undefined) return cached;
  const result = await _findAllBotSessions();
  lruCache.set(SESSIONS_ALL_KEY, result);
  return result;
}

// ── Bot Admin ─────────────────────────────────────────────────────────────────

export async function isBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<boolean> {
  const key = adminCheckKey(userId, platform, sessionId, adminId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _isBotAdmin(userId, platform, sessionId, adminId);
  lruCache.set(key, result);
  return result;
}

export async function addBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  await _addBotAdmin(userId, platform, sessionId, adminId);
  // Write true to the check cache so immediately-following permission checks don't
  // go to DB before the TTL window expires on the old false value.
  lruCache.set(adminCheckKey(userId, platform, sessionId, adminId), true);
  // Write-through: append to the cached list rather than evicting it — avoids a cold
  // DB hit on the listBotAdmins call that immediately follows from the dashboard.
  // Only mutate if already populated; an absent cache entry is left for lazy hydration.
  const listKey = adminListKey(userId, platform, sessionId);
  const cachedList = lruCache.get<string[]>(listKey);
  if (cachedList !== undefined) {
    lruCache.set(listKey, [...cachedList, adminId]);
  }
  // bot.repo.ts caches admin data inside bot:detail and bot:list responses using its
  // own separate keys — clear both so the dashboard reflects the new member immediately
  // rather than waiting for those TTLs to expire independently.
  lruCache.del(`bot:detail:${userId}:${sessionId}`);
  lruCache.del(`bot:list:${userId}`);
}

export async function removeBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  await _removeBotAdmin(userId, platform, sessionId, adminId);
  lruCache.set(adminCheckKey(userId, platform, sessionId, adminId), false);
  lruCache.del(adminListKey(userId, platform, sessionId));
}

export async function listBotAdmins(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const key = adminListKey(userId, platform, sessionId);
  const cached = lruCache.get<string[]>(key);
  if (cached !== undefined) return cached;
  const result = await _listBotAdmins(userId, platform, sessionId);
  lruCache.set(key, result);
  return result;
}

// ── Session Prefix ────────────────────────────────────────────────────────────

export async function updateBotSessionPrefix(
  userId: string,
  platform: string,
  sessionId: string,
  prefix: string,
): Promise<void> {
  await _updateBotSessionPrefix(userId, platform, sessionId, prefix);
  // The all-sessions list embeds the prefix field — clear it so session-loader
  // picks up the new prefix on next boot or session reload.
  lruCache.del(SESSIONS_ALL_KEY);
}
