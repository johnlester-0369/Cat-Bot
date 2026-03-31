/**
 * Facebook Page — getFullUserInfo
 *
 * The Page API exposes only `name` via GET /{userID}?fields=name.
 * Avatar, locale, and gender are unavailable through this endpoint.
 * Defaults to "User {userID}" when the profile fetch fails.
 */

import { PLATFORM_ID } from '../index.js';

import { createUnifiedUserInfo } from '@/adapters/models/user.model.js';
import type { UnifiedUserInfo } from '@/adapters/models/user.model.js';
import type { PageApi } from '@/adapters/platform/facebook-page/pageApi.js';

export async function getFullUserInfo(
  pageApi: PageApi,
  userID: string,
): Promise<UnifiedUserInfo> {
  return new Promise<UnifiedUserInfo>((resolve, reject) => {
    pageApi.getUserInfo([userID], (err, users) => {
      if (err) return reject(err);
      const u = users?.[userID] ?? {};
      resolve(
        createUnifiedUserInfo({
          platform: PLATFORM_ID,
          id: userID,
          name: (u as { name?: string }).name ?? `User ${userID}`,
          firstName: null,
          username: null,
          avatarUrl: null,
        }),
      );
    });
  });
}
