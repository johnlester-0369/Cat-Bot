/**
 * Platform ID Conversion Utilities
 *
 * Pure conversion layer between the human-readable platform string used throughout
 * the runtime (ctx.native.platform, UnifiedApi.platform) and the compact integer
 * stored in the database (bot_users.platform, bot_threads.platform).
 *
 * Conversion happens exactly once, at the model boundary (toBotThreadData /
 * toBotUserData).  No other layer ever reads or writes raw platform integers.
 */

import { PLATFORM_TO_ID, ID_TO_PLATFORM } from '@/constants/platform.constants.js';

/**
 * Converts a runtime platform string to its assigned database integer.
 *
 * Throws immediately on an unrecognised platform so callers surface the bug
 * at write-time rather than storing a silent zero or wrong ID.
 */
export function toPlatformNumericId(platform: string): number {
  // Cast to Record<string, number | undefined> to satisfy noUncheckedIndexedAccess —
  // PLATFORM_TO_ID is an as-const object, not an index signature, but the cast is
  // the safest way to express "may be absent at runtime" for unknown strings.
  const id = (PLATFORM_TO_ID as Record<string, number | undefined>)[platform];
  if (id === undefined) {
    throw new Error(
      `[platform-id] Unknown platform: "${platform}". ` +
        `Add it to PLATFORM_TO_ID in src/constants/platform.constants.ts before using it.`,
    );
  }
  return id;
}

/**
 * Converts a stored numeric platform ID back to its runtime string.
 *
 * Used when reading rows from bot_users / bot_threads and the calling code
 * needs the human-readable platform name for API calls or logging.
 */
export function fromPlatformNumericId(id: number): string {
  const name = (ID_TO_PLATFORM as Record<number, string | undefined>)[id];
  if (name === undefined) {
    throw new Error(
      `[platform-id] Unknown platform numeric id: ${id}. ` +
        `Ensure it exists in ID_TO_PLATFORM in src/constants/platform.constants.ts.`,
    );
  }
  return name;
}