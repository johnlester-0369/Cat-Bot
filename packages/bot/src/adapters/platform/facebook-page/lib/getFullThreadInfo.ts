/**
 * Facebook Page — getFullThreadInfo
 *
 * FB Page Messenger is always 1:1 — threadID IS the sender's Facebook user ID.
 * Calls getUserInfo(threadID) to derive the thread name; all group-related fields
 * are empty or defaulted because the Page API has no group thread concept.
 * getUserInfo failure is silently swallowed so a failed profile lookup never
 * crashes command handling.
 */

import { PLATFORM_ID } from '../index.js';

import { createUnifiedThreadInfo } from '@/adapters/models/thread.model.js';
import type { UnifiedThreadInfo } from '@/adapters/models/thread.model.js';
import type { PageApi } from '@/adapters/platform/facebook-page/pageApi.js';

export async function getFullThreadInfo(
  pageApi: PageApi,
  threadID: string,
): Promise<UnifiedThreadInfo> {
  let userInfo: { name?: string } | null = null;
  try {
    userInfo = await new Promise<{ name?: string } | null>(
      (resolve, reject) => {
        pageApi.getUserInfo([threadID], (err, users) =>
          err
            ? reject(err)
            : resolve((users?.[threadID] as { name?: string }) ?? null),
        );
      },
    );
  } catch {
    /* profile fetch failure is non-fatal; thread info still returned with null name */
  }

  return createUnifiedThreadInfo({
    platform: PLATFORM_ID,
    threadID,
    name: userInfo?.name ?? null,
    isGroup: false,
    memberCount: 2, // always exactly bot + sender on Page Messenger
    participantIDs: [threadID],
    adminIDs: [],
    avatarUrl: null,
  });
}
