/**
 * Bot Repo — LRU cache layer over the database adapter.
 *
 * getById, list, and getPlatformId are called on every dashboard API request and
 * on bot start/stop socket events. Caching prevents redundant DB reads while the
 * bot is running stably.
 *
 * Cross-repo invalidation:
 *   SESSIONS_ALL_KEY from credentials.repo.ts is also cleared on mutations here
 *   because botRepo.create / update / updateIsRunning mutate bot_session rows
 *   which findAllBotSessions in credentials.repo.ts also reads. Both repos share
 *   the same lruCache singleton so the shared key is the coordination point.
 */
import { botRepo as _botRepo } from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { SESSIONS_ALL_KEY } from '@/engine/repos/credentials.repo.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@/server/dtos/bot.dto.js';

// ── Cache key builders ────────────────────────────────────────────────────────

const botDetailKey = (userId: string, sessionId: string): string =>
  `bot:detail:${userId}:${sessionId}`;

const botListKey = (userId: string): string => `bot:list:${userId}`;

const botPlatformIdKey = (userId: string, sessionId: string): string =>
  `bot:platformId:${userId}:${sessionId}`;

// ── Wrapped botRepo — structurally compatible with the original BotRepo instance ──

export const botRepo = {
  async create(
    userId: string,
    sessionId: string,
    dto: CreateBotRequestDto,
  ): Promise<CreateBotResponseDto> {
    const result = await _botRepo.create(userId, sessionId, dto);
    // A new bot changes what the list endpoint returns for this owner.
    // sessions:all is also stale since session-loader reads it on next boot.
    lruCache.del(botListKey(userId));
    lruCache.del(SESSIONS_ALL_KEY);
    return result as CreateBotResponseDto;
  },

  async getById(
    userId: string,
    sessionId: string,
  ): Promise<GetBotDetailResponseDto | null> {
    const key = botDetailKey(userId, sessionId);
    const cached = lruCache.get<GetBotDetailResponseDto>(key);
    if (cached !== undefined) return cached;
    const result = await _botRepo.getById(userId, sessionId);
    // Only cache successful fetches — null (not found) has no stable identity to cache.
    if (result !== null) lruCache.set(key, result);
    return result as GetBotDetailResponseDto | null;
  },

  async update(
    userId: string,
    sessionId: string,
    dto: UpdateBotRequestDto,
    isCredentialsModified = false,
  ): Promise<void> {
    await _botRepo.update(userId, sessionId, dto, isCredentialsModified);
    // Detail and list both embed mutable fields (nickname, prefix, admins, credentials).
    lruCache.del(botDetailKey(userId, sessionId));
    lruCache.del(botListKey(userId));
    lruCache.del(botPlatformIdKey(userId, sessionId));
    lruCache.del(SESSIONS_ALL_KEY);

    const platform = dto.credentials.platform;
    lruCache.delByPrefix(`${userId}:${platform}:${sessionId}:`);
  },

  async list(userId: string): Promise<GetBotListResponseDto> {
    const key = botListKey(userId);
    const cached = lruCache.get<GetBotListResponseDto>(key);
    if (cached !== undefined) return cached;
    const result = await _botRepo.list(userId);
    lruCache.set(key, result);
    return result as GetBotListResponseDto;
  },

  async updateIsRunning(
    userId: string,
    sessionId: string,
    isRunning: boolean,
  ): Promise<void> {
    await _botRepo.updateIsRunning(userId, sessionId, isRunning);
    // isRunning is included in detail and list responses — clear both so the
    // dashboard immediately reflects the stopped/started state.
    lruCache.del(botDetailKey(userId, sessionId));
    lruCache.del(botListKey(userId));
    lruCache.del(SESSIONS_ALL_KEY);
  },

  async getPlatformId(
    userId: string,
    sessionId: string,
  ): Promise<number | null> {
    const key = botPlatformIdKey(userId, sessionId);
    const cached = lruCache.get<number | null>(key);
    if (cached !== undefined) return cached;
    const result = await _botRepo.getPlatformId(userId, sessionId);
    // Cache both found (number) and not-found (null) results — getPlatformId is
    // a lookup guard; null means the session doesn't exist and won't suddenly appear
    // without going through botRepo.create which clears the list cache.
    lruCache.set(key, result);
    return result as number | null;
  },

  async deleteById(userId: string, sessionId: string): Promise<void> {
    // Resolve the platform now so we can invalidate the credential prefix cache
    // key (userId:platform:sessionId:*) that the adapter layer may have populated.
    const detail = await _botRepo.getById(userId, sessionId);
    await _botRepo.deleteById(userId, sessionId);

    // Bust every cache key that references this session — reads after deletion must
    // never return stale data from the LRU store.
    lruCache.del(botDetailKey(userId, sessionId));
    lruCache.del(botListKey(userId));
    lruCache.del(botPlatformIdKey(userId, sessionId));
    lruCache.del(SESSIONS_ALL_KEY);
    if (detail) {
      lruCache.delByPrefix(`${userId}:${detail.platform}:${sessionId}:`);
    }
  },
};
