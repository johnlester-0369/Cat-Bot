/**
 * BotUser Model — Type definitions and mapper for persistent user records.
 *
 * Bridges UnifiedUserInfo (produced by ctx.user.getInfo()) and the flat data
 * shape the Prisma repository layer accepts. Keeping the mapper here means:
 *   - Repo files never import from adapters/ (clean dependency direction)
 *   - Field renames (e.g. UnifiedUserInfo.id → BotUser.userId) live in one place
 */

import type { UnifiedUserInfo } from '@/adapters/models/user.model.js';
// Convert the platform string to its numeric DB ID at the model boundary
import { toPlatformNumericId } from '@/utils/platform-id.util.js';

// ── BotUserData — the shape repos write to bot_users ─────────────────────────

/**
 * Flat data shape accepted by upsertUser().
 * Mirrors the Prisma BotUser model's non-auto fields so the repo can pass it
 * directly to prisma.botUser.upsert() without knowing UnifiedUserInfo's field names.
 */
export interface BotUserData {
  /** Platform identifier — e.g. 'discord', 'telegram', 'facebook-messenger', 'facebook-page'. */
  platform: number;
  /** Platform-specific user ID (always a string for cross-platform consistency). Renamed to 'id' for DB consistency. */
  id: string;
  /** Best available display name — never empty; platform wrappers guarantee this. */
  name: string;
  /** First name if the platform surfaces it separately; null otherwise. */
  firstName: string | null;
  /** Handle / vanity slug without @ prefix; null if unavailable. */
  username: string | null;
  /** Profile picture URL; null if unavailable or requires authentication. */
  avatarUrl: string | null;
}

// ── Mapper ────────────────────────────────────────────────────────────────────

/**
 * Maps a UnifiedUserInfo object to the BotUserData shape the repository accepts.
 *
 * UnifiedUserInfo uses `id` for the platform user ID; BotUser uses `userId` so
 * the auto-increment primary key can remain a plain `id` without ambiguity.
 */
export function toBotUserData(info: UnifiedUserInfo): BotUserData {
  return {
    platform: toPlatformNumericId(info.platform),
    // UnifiedUserInfo uses id; BotUserData also uses id as the primary key
    id: info.id,
    name: info.name,
    firstName: info.firstName ?? null,
    username: info.username ?? null,
    avatarUrl: info.avatarUrl ?? null,
  };
}
