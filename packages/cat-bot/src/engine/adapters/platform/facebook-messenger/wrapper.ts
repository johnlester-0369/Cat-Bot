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

import { Platforms } from '@/engine/modules/platform/platform.constants.js';

import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
} from '@/engine/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';
import type { Readable } from 'stream';

import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
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

// FB Messenger has no zero-cost name endpoint — delegate to the database layer which
// stores user/thread names from previous interactions (bot_users / bot_threads tables).
import { getUserName as dbGetUserName } from '@/engine/repos/users.repo.js';
import { getThreadName as dbGetThreadName } from '@/engine/repos/threads.repo.js';

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
  override editMessage(
    messageID: string,
    options:
      | string
      | import('@/engine/adapters/models/api.model.js').EditMessageOptions,
  ): Promise<void> {
    logger.debug('[facebook-messenger] editMessage called', { messageID });
    return editMessage(this.#api, messageID, options);
  }
  override setNickname(
    threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    logger.debug('[facebook-messenger] setNickname called', {
      threadID,
      userID,
    });
    return setNickname(this.#api, threadID, userID, nickname);
  }
  override getUserInfo(
    userIds: string[],
  ): Promise<Record<string, { name: string }>> {
    logger.debug('[facebook-messenger] getUserInfo called', {
      userCount: userIds.length,
    });
    return getUserInfo(this.#api, userIds);
  }
  override setGroupName(threadID: string, name: string): Promise<void> {
    logger.debug('[facebook-messenger] setGroupName called', {
      threadID,
      name,
    });
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
    logger.debug('[facebook-messenger] removeGroupImage called', {
      threadID: _threadID,
    });
    return removeGroupImage();
  }
  override addUserToGroup(threadID: string, userID: string): Promise<void> {
    logger.debug('[facebook-messenger] addUserToGroup called', {
      threadID,
      userID,
    });
    return addUserToGroup(this.#api, threadID, userID);
  }
  override removeUserFromGroup(
    threadID: string,
    userID: string,
  ): Promise<void> {
    logger.debug('[facebook-messenger] removeUserFromGroup called', {
      threadID,
      userID,
    });
    return removeUserFromGroup(this.#api, threadID, userID);
  }
  override setGroupReaction(threadID: string, emoji: string): Promise<void> {
    logger.debug('[facebook-messenger] setGroupReaction called', {
      threadID,
      emoji,
    });
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
    logger.debug('[facebook-messenger] reactToMessage called', {
      threadID,
      messageID,
      emoji,
    });
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

  /**
   * Delegates to the database layer — fca-unofficial has no zero-cost getUserName endpoint.
   * bot_users is populated during upsertUser calls on every incoming message, so names
   * resolved this way reflect the most recently observed display name for the user.
   */
  override getUserName(userID: string): Promise<string> {
    logger.debug('[facebook-messenger] getUserName called (db fallback)', {
      userID,
    });
    return dbGetUserName(userID);
  }

  /**
   * Delegates to the database layer — thread names are stored in bot_threads on first encounter.
   */
  override getThreadName(threadID: string): Promise<string> {
    logger.debug('[facebook-messenger] getThreadName called (db fallback)', {
      threadID,
    });
    return dbGetThreadName(threadID);
  }

  /**
   * Public Graph API photo endpoint — works with any Facebook PSID without additional OAuth scopes.
   * The access_token embedded in the URL is a public app-level token sufficient for profile photos.
   */
  override getAvatarUrl(userID: string): Promise<string | null> {
    logger.debug('[facebook-messenger] getAvatarUrl called', { userID });
    return Promise.resolve(
      `https://graph.facebook.com/${userID}/picture?height=256&width=256&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`,
    );
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createFacebookApi(fcaApi: FcaApi): UnifiedApi {
  return new FacebookApi(fcaApi);
}
