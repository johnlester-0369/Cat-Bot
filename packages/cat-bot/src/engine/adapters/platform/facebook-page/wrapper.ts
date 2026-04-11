/**
 * Facebook Page Platform Wrapper
 *
 * Pure wiring layer — the class shell delegates every UnifiedApi method to its
 * corresponding lib/<method>.ts module. No business logic lives here.
 *
 * Architecture:
 *   lib/        — individual method implementations (each independently testable)
 *   utils/      — event normalisation and attachment mappers
 *   pageApi/    — Graph API factory and HTTP helpers (types.ts, helpers.ts, pageApi.ts)
 *   types.ts    — listener-level type definitions
 *
 * Normalise functions are NOT re-exported here — consumers import directly
 * from utils/helper.util.js to maintain clear ownership boundaries.
 */
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
  UserInfo,
} from '@/engine/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';
import type { Readable } from 'stream';

import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
// ── PageApi type ──────────────────────────────────────────────────────────────
import type { PageApi } from './pageApi.js';

// FB Page has no zero-cost name endpoint — delegate to the database layer which
// stores user/thread names from previous interactions (bot_users / bot_threads tables).
import { getUserName as dbGetUserName } from '@/engine/repos/users.repo.js';
import { getThreadName as dbGetThreadName } from '@/engine/repos/threads.repo.js';

// ── Method lib imports ────────────────────────────────────────────────────────
import { sendMessage } from './lib/sendMessage.js';
import { unsendMessage } from './lib/unsendMessage.js';
import { getUserInfo } from './lib/getUserInfo.js';
import { replyMessage } from './lib/replyMessage.js';
import { getBotID } from './lib/getBotID.js';
import { getFullThreadInfo } from './lib/getFullThreadInfo.js';
import { getFullUserInfo } from './lib/getFullUserInfo.js';
import {
  editMessage,
  setNickname,
  setGroupName,
  setGroupImage,
  removeGroupImage,
  addUserToGroup,
  removeUserFromGroup,
  setGroupReaction,
  reactToMessage,
} from './unsupported.js';

// ── Class shell ───────────────────────────────────────────────────────────────

class FbPageApi extends UnifiedApi {
  readonly #pageApi: PageApi;

  constructor(pageApi: PageApi) {
    super();
    this.platform = Platforms.FacebookPage;
    this.#pageApi = pageApi;
  }

  // ── Implemented methods ───────────────────────────────────────────────────

  override sendMessage(
    msg: string | SendPayload,
    threadID: string,
  ): Promise<string | undefined> {
    logger.debug('[facebook-page] sendMessage called', { threadID });
    return sendMessage(this.#pageApi, msg, threadID);
  }

  override unsendMessage(messageID: string): Promise<void> {
    logger.debug('[facebook-page] unsendMessage called', { messageID });
    return unsendMessage(this.#pageApi, messageID);
  }

  override getUserInfo(userIds: string[]): Promise<Record<string, UserInfo>> {
    logger.debug('[facebook-page] getUserInfo called', {
      userCount: userIds.length,
    });
    return getUserInfo(this.#pageApi, userIds);
  }

  override replyMessage(
    threadID: string,
    opts: ReplyMessageOptions = {},
  ): Promise<unknown> {
    logger.debug('[facebook-page] replyMessage called', { threadID });
    return replyMessage(this.#pageApi, threadID, opts);
  }

  override getBotID(): Promise<string> {
    logger.debug('[facebook-page] getBotID called');
    return getBotID(this.#pageApi);
  }

  override getFullThreadInfo(threadID: string): Promise<UnifiedThreadInfo> {
    logger.debug('[facebook-page] getFullThreadInfo called', { threadID });
    return getFullThreadInfo(this.#pageApi, threadID);
  }

  override getFullUserInfo(userID: string): Promise<UnifiedUserInfo> {
    logger.debug('[facebook-page] getFullUserInfo called', { userID });
    return getFullUserInfo(this.#pageApi, userID);
  }

  /**
   * Delegates to the database layer — FB Page is always 1:1; the Graph API would
   * require a paid /me/conversations endpoint for names. bot_users is populated on
   * every incoming message so this reflects the most recently seen display name.
   */
  override getUserName(userID: string): Promise<string> {
    logger.debug('[facebook-page] getUserName called (db fallback)', {
      userID,
    });
    return dbGetUserName(userID);
  }

  /**
   * Delegates to the database layer — Page Messenger threads are always 1:1; names
   * stored in bot_threads reflect the user's name at the time of their last message.
   */
  override getThreadName(threadID: string): Promise<string> {
    logger.debug('[facebook-page] getThreadName called (db fallback)', {
      threadID,
    });
    return dbGetThreadName(threadID);
  }

  // ── Unsupported stubs (FB Page is always 1:1; no group or edit endpoints) ──

  override editMessage(messageID: string, newBody: string): Promise<void> {
    logger.debug('[facebook-page] editMessage called', { messageID });
    return editMessage(messageID, newBody);
  }

  override setNickname(
    threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    logger.debug('[facebook-page] setNickname called', { threadID, userID });
    return setNickname(threadID, userID, nickname);
  }

  override setGroupName(threadID: string, name: string): Promise<void> {
    logger.debug('[facebook-page] setGroupName called', { threadID, name });
    return setGroupName(threadID, name);
  }

  override setGroupImage(
    threadID: string,
    imageSource: Buffer | Readable | string,
  ): Promise<void> {
    logger.debug('[facebook-page] setGroupImage called', { threadID });
    return setGroupImage(threadID, imageSource);
  }

  override removeGroupImage(threadID: string): Promise<void> {
    logger.debug('[facebook-page] removeGroupImage called', { threadID });
    return removeGroupImage(threadID);
  }

  override addUserToGroup(threadID: string, userID: string): Promise<void> {
    logger.debug('[facebook-page] addUserToGroup called', { threadID, userID });
    return addUserToGroup(threadID, userID);
  }

  override removeUserFromGroup(
    threadID: string,
    userID: string,
  ): Promise<void> {
    logger.debug('[facebook-page] removeUserFromGroup called', {
      threadID,
      userID,
    });
    return removeUserFromGroup(threadID, userID);
  }

  override setGroupReaction(threadID: string, emoji: string): Promise<void> {
    logger.debug('[facebook-page] setGroupReaction called', {
      threadID,
      emoji,
    });
    return setGroupReaction(threadID, emoji);
  }

  override reactToMessage(
    threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    logger.debug('[facebook-page] reactToMessage called', {
      threadID,
      messageID,
      emoji,
    });
    return reactToMessage(threadID, messageID, emoji);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createFbPageApi(pageApi: PageApi): UnifiedApi {
  return new FbPageApi(pageApi);
}
