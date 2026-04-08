/**
 * Cat-Bot — Unified Thread Info Model
 *
 * Single source of truth for thread / group / server representations across all platforms.
 * Every platform wrapper's getFullThreadInfo() must produce this shape.
 *
 * Platform concept mapping:
 *   Discord      → Enclosing Guild (server); threadID is the channel ID used to locate it.
 *                  raw.guild contains the full server model including channels and cached members.
 *   Telegram     → Chat object (group, supergroup, channel, or private DM).
 *                  adminIDs populated via getChatAdministrators for group/supergroup types.
 *   FB Messenger → fca-unofficial api.getThreadInfo() result (group thread or 1:1).
 *                  Includes adminIDs from the native response; emoji and nicknames are
 *                  fb-messenger-specific and live in raw for consumers that need them.
 *   FB Page      → Always 1:1 — threadID IS the sender's Facebook user ID.
 *                  thread.name is derived from getUserInfo on the sender.
 *
 * The `raw` field carries the native platform object untouched so command modules
 * that need platform-specific data (Discord roles/emojis, fca nicknames, Telegram
 * pinned_message, etc.) can access it without breaking the unified contract.
 */

// PlatformId is `string` so thread.model stays a dependency-free leaf node.
// Concrete IDs are owned by each adapters/platform/{name}/index.ts and aggregated
// into a union at adapters/platform/index.ts — models never enumerate platform names.
export type PlatformId = string;
import { logger } from '@/engine/lib/logger.lib.js';

/**
 * Unified shape for thread / group / server metadata across all platforms.
 * Platform wrappers return this from getFullThreadInfo(); command modules
 * read only these fields so they remain platform-agnostic.
 */
export interface UnifiedThreadInfo {
  /** Source platform identifier — matches platform wrappers' this.platform value. */
  platform: PlatformId;
  /** Platform-specific thread / chat / channel ID (always a string). */
  threadID: string;
  /** Display name of the group; null for unnamed threads or DMs. */
  name: string | null;
  /** True when there are more than 2 participants. */
  isGroup: boolean;
  /** Approximate total member count; null if the platform does not expose it. */
  memberCount: number | null;
  /** Known participant IDs; may be partial for large guilds (Discord cache limit). */
  participantIDs: string[];
  /** Admin / moderator user IDs; may be partial or empty depending on platform. */
  adminIDs: string[];
  /** Group icon URL; null if not set or inaccessible. */
  avatarUrl: string | null;
}

/**
 * Frozen prototype documenting every key a consumer may safely read.
 * Useful for tests and as a reference shape — createUnifiedThreadInfo() is the
 * production factory and should be used instead of spreading this object.
 */
export const PROTO_UNIFIED_THREAD_INFO: Readonly<UnifiedThreadInfo> =
  Object.freeze({
    platform: 'unknown' as PlatformId,
    threadID: '',
    name: null,
    isGroup: false,
    memberCount: null,
    participantIDs: [],
    adminIDs: [],
    avatarUrl: null,
  });

/**
 * Creates a UnifiedThreadInfo from partial data, filling in safe defaults for any
 * missing field. All platform wrapper getFullThreadInfo() implementations must go
 * through this factory — never construct the shape inline, so that adding a new
 * field only requires one change here.
 */
export function createUnifiedThreadInfo(
  data: Partial<UnifiedThreadInfo>,
): UnifiedThreadInfo {
  logger.debug('[thread.model] createUnifiedThreadInfo called', { platform: data.platform, threadID: data.threadID });
  return {
    platform: data.platform ?? 'unknown',
    threadID: data.threadID ?? '',
    name: data.name ?? null,
    isGroup: data.isGroup ?? false,
    memberCount: data.memberCount ?? null,
    participantIDs: data.participantIDs ?? [],
    adminIDs: data.adminIDs ?? [],
    avatarUrl: data.avatarUrl ?? null,
  };
}
