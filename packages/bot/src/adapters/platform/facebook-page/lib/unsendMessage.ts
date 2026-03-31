/**
 * Facebook Page — unsendMessage
 *
 * pageApi.unsendMessage is a no-op (Page API requires special DELETE permissions
 * not available to standard page tokens). Wrapping in a Promise keeps the
 * interface consistent — callers need not know it's a no-op.
 */

import type { PageApi } from '@/adapters/platform/facebook-page/pageApi.js';

export function unsendMessage(
  pageApi: PageApi,
  messageID: string,
): Promise<void> {
  return new Promise((resolve) => {
    pageApi.unsendMessage(messageID, () => resolve());
  });
}
