/**
 * Resolves display names for a list of user IDs via fca-unofficial getUserInfo.
 * Normalises the response so every requested ID always has a `name` string —
 * fca may omit entries or return without a `name` key when a thread/group ID is
 * accidentally passed instead of a real user ID.
 */

import type { UserInfo } from '@/adapters/models/api.model.js';

interface FcaUserData {
  name?: string;
  firstName?: string;
  [key: string]: unknown;
}

interface FcaApi {
  getUserInfo(
    ids: string[],
    cb: (err: unknown, users: Record<string, FcaUserData> | undefined) => void,
  ): void;
}

export function getUserInfo(
  api: FcaApi,
  userIds: string[],
): Promise<Record<string, UserInfo>> {
  return new Promise((resolve, reject) => {
    api.getUserInfo(userIds, (err, users) => {
      if (err) return reject(err);
      const normalized: Record<string, UserInfo> = {};
      for (const uid of userIds) {
        const raw = users?.[uid];
        // Spread raw first so the explicit name fallback wins over any undefined name property
        normalized[uid] = {
          ...raw,
          name: raw?.name ?? raw?.firstName ?? `User ${uid}`,
        };
      }
      resolve(normalized);
    });
  });
}
