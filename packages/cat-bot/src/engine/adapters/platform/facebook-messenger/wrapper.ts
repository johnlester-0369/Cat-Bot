/**
 * Facebook Messenger Platform Wrapper (fca-unofficial)
 *
 * Pure orchestration layer:
 *   - FacebookApi delegates every method to a single-responsibility lib function.
 *   - No business logic lives here — only wiring between the fca api instance and lib/.
 *   - Types imported from types.ts; normalizeMessageEvent re-exported from utils/.
 *
 * To change any send/receive behaviour, edit the corresponding lib/<method>.ts file.
 */

import { Platforms } from '@/engine/constants/platform.constants.js';

import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
} from '@/engine/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';
import type { Readable } from 'stream';

import { logger } from '@/engine/lib/logger.lib.js';
import type { FcaApi } from './types.js';

import { sendMessage } from './lib/sendMessage.js';
import { unsendMessage } from './lib/unsendMessage.js';
import { editMessage } from './lib/editMessage.js';
import { setNickname } from './lib/setNickname.js';
import { getUserInfo } from './lib/getUserInfo.js';
import { setGroupName } from './lib/setGroupName.js';
import { setGroupImage } from './lib/setGroupImage.js';
import { addUserToGroup } from './lib/addUserToGroup.js';
import { removeUserFromGroup } from './lib/removeUserFromGroup.js';
import { setGroupReaction } from './lib/setGroupReaction.js';
import { replyMessage } from './lib/replyMessage.js';
import { reactToMessage } from './lib/reactToMessage.js';
import { getBotID } from './lib/getBotID.js';
import { getFullThreadInfo } from './lib/getFullThreadInfo.js';
import { getFullUserInfo } from './lib/getFullUserInfo.js';

// Unsupported operations consolidated into single file for discoverability
import { removeGroupImage } from './unsupported.js';

// Re-export normalizeMessageEvent from its dedicated module so existing
// consumers (index.ts dynamic import) continue to resolve it through wrapper.js
export { normalizeMessageEvent } from './utils/normalize-event.js';

// ── FacebookApi ────────────────────────────────────────────────────────────────

class FacebookApi extends UnifiedApi {
  // Private field — fca api instance stays encapsulated; no external code should call fca directly
  readonly #api: FcaApi;

  constructor(fcaApi: FcaApi) {
    super();
    this.platform = Platforms.FacebookMessenger;
    this.#api = fcaApi;
  }

  override sendMessage(
    msg: string | SendPayload,
    threadID: string,
  ): Promise<string | undefined> {
    logger.debug('[facebook-messenger] sendMessage called', { threadID });
    return sendMessage(this.#api, msg, threadID);
  }
  override unsendMessage(messageID: string): Promise<void> {
    logger.debug('[facebook-messenger] unsendMessage called', { messageID });
    return unsendMessage(this.#api, messageID);
  }
  override editMessage(messageID: string, newBody: string): Promise<void> {
    logger.debug('[facebook-messenger] editMessage called', { messageID });
    return editMessage(this.#api, messageID, newBody);
  }
  override setNickname(
    threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    logger.debug('[facebook-messenger] setNickname called', { threadID, userID });
    return setNickname(this.#api, threadID, userID, nickname);
  }
  override getUserInfo(
    userIds: string[],
  ): Promise<Record<string, { name: string }>> {
    logger.debug('[facebook-messenger] getUserInfo called', { userCount: userIds.length });
    return getUserInfo(this.#api, userIds);
  }
  override setGroupName(threadID: string, name: string): Promise<void> {
    logger.debug('[facebook-messenger] setGroupName called', { threadID, name });
    return setGroupName(this.#api, threadID, name);
  }
  override setGroupImage(
    threadID: string,
    imageSource: Buffer | Readable | string,
  ): Promise<void> {
    logger.debug('[facebook-messenger] setGroupImage called', { threadID });
    return setGroupImage(this.#api, threadID, imageSource);
  }
  override removeGroupImage(_threadID: string): Promise<void> {
    logger.debug('[facebook-messenger] removeGroupImage called', { threadID: _threadID });
    return removeGroupImage();
  }
  override addUserToGroup(threadID: string, userID: string): Promise<void> {
    logger.debug('[facebook-messenger] addUserToGroup called', { threadID, userID });
    return addUserToGroup(this.#api, threadID, userID);
  }
  override removeUserFromGroup(
    threadID: string,
    userID: string,
  ): Promise<void> {
    logger.debug('[facebook-messenger] removeUserFromGroup called', { threadID, userID });
    return removeUserFromGroup(this.#api, threadID, userID);
  }
  override setGroupReaction(threadID: string, emoji: string): Promise<void> {
    logger.debug('[facebook-messenger] setGroupReaction called', { threadID, emoji });
    return setGroupReaction(this.#api, threadID, emoji);
  }
  override replyMessage(
    threadID: string,
    options: ReplyMessageOptions = {},
  ): Promise<unknown> {
    logger.debug('[facebook-messenger] replyMessage called', { threadID });
    return replyMessage(this.#api, threadID, options);
  }
  override reactToMessage(
    threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    logger.debug('[facebook-messenger] reactToMessage called', { threadID, messageID, emoji });
    return reactToMessage(this.#api, threadID, messageID, emoji);
  }
  override getBotID(): Promise<string> {
    logger.debug('[facebook-messenger] getBotID called');
    return getBotID(this.#api);
  }
  override getFullThreadInfo(threadID: string): Promise<UnifiedThreadInfo> {
    logger.debug('[facebook-messenger] getFullThreadInfo called', { threadID });
    return getFullThreadInfo(this.#api, threadID);
  }
  override getFullUserInfo(userID: string): Promise<UnifiedUserInfo> {
    logger.debug('[facebook-messenger] getFullUserInfo called', { userID });
    return getFullUserInfo(this.#api, userID);
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createFacebookApi(fcaApi: FcaApi): UnifiedApi {
  return new FacebookApi(fcaApi);
}
