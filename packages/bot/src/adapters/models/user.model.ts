/**
 * Cat-Bot — Unified User Info Model
 *
 * Single source of truth for user representations across all platforms.
 * Every platform wrapper's getFullUserInfo() must produce this shape.
 *
 * Platform concept mapping:
 *   Discord      → User object fetched via client.users.fetch(); guild member overlay when available
 *   Telegram     → User from getChatMember / ctx.from; no standalone getUser endpoint in Bot API
 *   FB Messenger → fca-unofficial api.getUserInfo() result (keyed by userId)
 *   FB Page      → Graph API GET /{userID}?fields=name via pageApi.getUserInfo()
 *
 * The `raw` field carries the native platform object untouched so command modules
 * that need platform-specific fields (Discord flags, Telegram premium_type, fca gender/
 * isFriend/vanity) can read from raw without breaking the unified contract.
 */

// PlatformId is `string` so user.model stays a dependency-free leaf node.
// Concrete IDs are owned by each adapters/platform/{name}/index.ts and aggregated
// into a union at adapters/platform/index.ts — models never enumerate platform names.
export type PlatformId = string;

/**
 * Unified shape for user metadata across all platforms.
 * Platform wrappers return this from getFullUserInfo(); command modules
 * read only these fields so they remain platform-agnostic.
 */
export interface UnifiedUserInfo {
  /** Source platform identifier. */
  platform: PlatformId;
  /** User's platform-specific ID (always a string for cross-platform consistency). */
  id: string;
  /** Best available display name — never empty; falls back to "User {id}" in wrappers. */
  name: string;
  /** First name if separately available; null otherwise. */
  firstName: string | null;
  /** Handle / vanity URL slug without @ prefix; null if unavailable. */
  username: string | null;
  /** Profile picture URL; null if unavailable or not accessible without auth. */
  avatarUrl: string | null;
}

/**
 * Frozen prototype documenting every key a consumer may safely read.
 * createUnifiedUserInfo() is the production factory; use that instead of
 * spreading this object to ensure new fields always get defaults.
 */
export const PROTO_UNIFIED_USER_INFO: Readonly<UnifiedUserInfo> = Object.freeze(
  {
    platform: 'unknown' as PlatformId,
    id: '',
    name: '',
    firstName: null,
    username: null,
    avatarUrl: null,
  },
);

/**
 * Creates a UnifiedUserInfo from partial data, filling in safe defaults for any
 * missing field. All platform wrapper getFullUserInfo() implementations must go
 * through this factory — never construct the shape inline, so that adding a new
 * field only requires one change here.
 */
export function createUnifiedUserInfo(
  data: Partial<UnifiedUserInfo>,
): UnifiedUserInfo {
  return {
    platform: data.platform ?? 'unknown',
    id: data.id ?? '',
    name: data.name ?? '',
    firstName: data.firstName ?? null,
    username: data.username ?? null,
    avatarUrl: data.avatarUrl ?? null,
  };
}
