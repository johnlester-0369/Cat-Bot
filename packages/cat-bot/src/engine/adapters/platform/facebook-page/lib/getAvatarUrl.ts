/**
 * Facebook Page — getAvatarUrl
 *
 * Retrieves the profile picture URL for a user given their PSID (Page-Scoped ID)
 * via the Facebook Graph API `?fields=profile_pic` endpoint.
 */

import type { PageApi } from '../pageApi-types.js';

export async function getAvatarUrl(
  pageApi: PageApi,
  userID: string,
): Promise<string | null> {
  return pageApi.getAvatarUrl(userID);
}