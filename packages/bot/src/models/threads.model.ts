/**
 * BotThread Model — Type definitions and mapper for persistent thread records.
 *
 * Bridges UnifiedThreadInfo (produced by ctx.thread.getInfo()) and the flat data
 * shape the Prisma repository layer accepts for multi-model upserting.
 */

import type { UnifiedThreadInfo } from '@/adapters/models/thread.model.js';
// Convert the platform string to its numeric DB ID at the model boundary
import { toPlatformNumericId } from '@/utils/platform-id.util.js';

// ── BotThreadData — the shape repos write to bot_threads ─────────────────────

/**
 * Data shape accepted by upsertThread().
 * participantIDs and adminIDs are mapped internally to Prisma many-to-many connections.
 */
export interface BotThreadData {
  /** Platform identifier — e.g. 'discord', 'telegram', 'facebook-messenger'. */
  platform: number;
  /** Platform-specific thread / channel / group ID (always a string). Renamed to 'id' for DB consistency. */
  id: string;
  /** Display name of the group; null for unnamed threads or DMs. */
  name: string | null;
  /** True when there are more than 2 participants. */
  isGroup: boolean;
  /** Approximate member count; null when the platform does not expose it. */
  memberCount: number | null;
  /** Array of known participant user IDs to be connected via relation table. */
  participantIDs: string[];
  /** Array of admin / moderator user IDs to be connected via relation table. */
  adminIDs: string[];
  /** Group icon URL; null when not set or inaccessible. */
  avatarUrl: string | null;
}

// ── Mapper ────────────────────────────────────────────────────────────────────

/**
 * Maps a UnifiedThreadInfo to BotThreadData.
 *
 * UnifiedThreadInfo uses `threadID`; BotThread uses `threadId` (camelCase
 * consistency with Prisma conventions for non-ID fields).
 */
export function toBotThreadData(info: UnifiedThreadInfo): BotThreadData {
  return {
    platform: toPlatformNumericId(info.platform),
    // Map UnifiedThreadInfo.threadID to the generic 'id' PK
    id: info.threadID,
    name: info.name ?? null,
    isGroup: info.isGroup,
    memberCount: info.memberCount ?? null,
    participantIDs: info.participantIDs,
    adminIDs: info.adminIDs,
    avatarUrl: info.avatarUrl ?? null,
  };
}
