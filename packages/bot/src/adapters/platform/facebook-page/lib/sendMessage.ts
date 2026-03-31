/**
 * Facebook Page — sendMessage
 *
 * Wraps the pageApi callback interface into a Promise so every caller in the
 * class shell uses async/await uniformly. Returns the Graph API message_id
 * ("m_...") on success, or undefined when pageApi returns no result object.
 */

import type { SendPayload } from '@/adapters/models/api.model.js';
import type { PageApi } from '@/adapters/platform/facebook-page/pageApi.js';

export function sendMessage(
  pageApi: PageApi,
  msg: string | SendPayload,
  threadID: string,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    pageApi.sendMessage(
      msg as string | Record<string, unknown>,
      threadID,
      (err, data) => (err ? reject(err) : resolve(data?.messageID)),
    );
  });
}
