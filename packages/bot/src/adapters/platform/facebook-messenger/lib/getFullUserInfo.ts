/**
 * Returns a UnifiedUserInfo by calling fca-unofficial api.getUserInfo().
 * fca returns gender as a number (legacy: 1=FEMALE, 2=MALE) or string on newer endpoints;
 * we don't surface gender on the unified model, so it stays in the raw fca response.
 */

import { PLATFORM_ID } from '../index.js';

// @/ alias for cross-cutting model types — avoids fragile ../../../../ relative chains
import { createUnifiedUserInfo } from '@/adapters/models/user.model.js';
import type { UnifiedUserInfo } from '@/adapters/models/user.model.js';

/** Minimal fca user shape returned by api.getUserInfo(). */
interface FcaUserData {
  name?: string;
  firstName?: string;
  vanity?: string | null;
  thumbSrc?: string | null;
  profileUrl?: string | null;
}

interface FcaApi {
  getUserInfo(
    ids: string[],
    cb: (err: unknown, users: Record<string, FcaUserData> | undefined) => void,
  ): void;
}

export function getFullUserInfo(
  api: FcaApi,
  userID: string,
): Promise<UnifiedUserInfo> {
  return new Promise((resolve, reject) => {
    api.getUserInfo([userID], (err, users) => {
      if (err) return reject(err);
      const u = users?.[userID] ?? {};
      resolve(
        createUnifiedUserInfo({
          platform: PLATFORM_ID,
          id: userID,
          name: u.name ?? u.firstName ?? `User ${userID}`,
          firstName: u.firstName ?? null,
          username: u.vanity ?? null,
          avatarUrl: u.thumbSrc ?? u.profileUrl ?? null,
        }),
      );
    });
  });
}
