/**
 * Returns a UnifiedThreadInfo by calling fca-unofficial api.getThreadInfo().
 * Includes participants, admins, nicknames, and the thread emoji from the native response.
 * adminIDs is normalised to a string array since fca returns either string or { id: string }.
 */

import { PLATFORM_ID } from '../index.js';

// @/ alias for cross-cutting model types — avoids fragile ../../../../ relative chains
import { createUnifiedThreadInfo } from '@/adapters/models/thread.model.js';
import type { UnifiedThreadInfo } from '@/adapters/models/thread.model.js';

/** Minimal fca thread info shape returned by api.getThreadInfo(). */
interface FcaThreadInfo {
  adminIDs?: Array<string | { id: string }>;
  threadName?: string | null;
  isGroup?: boolean;
  participantIDs?: string[];
  imageSrc?: string | null;
}

interface FcaApi {
  getThreadInfo(
    threadID: string,
    cb: (err: unknown, info: FcaThreadInfo) => void,
  ): void;
}

export function getFullThreadInfo(
  api: FcaApi,
  threadID: string,
): Promise<UnifiedThreadInfo> {
  return new Promise((resolve, reject) => {
    api.getThreadInfo(threadID, (err, info) => {
      if (err) return reject(err);
      const adminIDs = (info.adminIDs ?? []).map((a) =>
        typeof a === 'string' ? a : a.id,
      );
      resolve(
        createUnifiedThreadInfo({
          platform: PLATFORM_ID,
          threadID,
          name: info.threadName ?? null,
          isGroup: info.isGroup ?? false,
          memberCount: (info.participantIDs ?? []).length || null,
          participantIDs: info.participantIDs ?? [],
          adminIDs,
          avatarUrl: info.imageSrc ?? null,
        }),
      );
    });
  });
}
