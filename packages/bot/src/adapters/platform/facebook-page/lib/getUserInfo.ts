/**
 * Facebook Page — getUserInfo
 *
 * Resolves the pageApi callback interface into a Promise so callers use await uniformly.
 */

import type { PageApi } from '@/adapters/platform/facebook-page/pageApi.js';

export function getUserInfo(
  pageApi: PageApi,
  userIds: string[],
): Promise<Record<string, { name: string }>> {
  return new Promise((resolve, reject) => {
    pageApi.getUserInfo(userIds, (err, users) =>
      err ? reject(err) : resolve(users ?? {}),
    );
  });
}
