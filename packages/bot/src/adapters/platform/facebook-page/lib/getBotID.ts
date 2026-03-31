/**
 * Facebook Page — getBotID
 *
 * Returns the Facebook Page ID associated with this access token.
 * pageApi.getPageId() lazily fetches and caches the ID on first call.
 */

import type { PageApi } from '@/adapters/platform/facebook-page/pageApi.js';

export async function getBotID(pageApi: PageApi): Promise<string> {
  return pageApi.getPageId();
}
