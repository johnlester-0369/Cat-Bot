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
import { Platforms } from '@/constants/platform.constants.js';

import { UnifiedApi } from '@/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
  UserInfo,
} from '@/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/adapters/models/user.model.js';
import type { Readable } from 'stream';

// ── PageApi type ──────────────────────────────────────────────────────────────
import type { PageApi } from './pageApi.js';

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
    return sendMessage(this.#pageApi, msg, threadID);
  }

  override unsendMessage(messageID: string): Promise<void> {
    return unsendMessage(this.#pageApi, messageID);
  }

  override getUserInfo(userIds: string[]): Promise<Record<string, UserInfo>> {
    return getUserInfo(this.#pageApi, userIds);
  }

  override replyMessage(
    threadID: string,
    opts: ReplyMessageOptions = {},
  ): Promise<unknown> {
    return replyMessage(this.#pageApi, threadID, opts);
  }

  override getBotID(): Promise<string> {
    return getBotID(this.#pageApi);
  }

  override getFullThreadInfo(threadID: string): Promise<UnifiedThreadInfo> {
    return getFullThreadInfo(this.#pageApi, threadID);
  }

  override getFullUserInfo(userID: string): Promise<UnifiedUserInfo> {
    return getFullUserInfo(this.#pageApi, userID);
  }

  // ── Unsupported stubs (FB Page is always 1:1; no group or edit endpoints) ──

  override editMessage(messageID: string, newBody: string): Promise<void> {
    return editMessage(messageID, newBody);
  }

  override setNickname(
    threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    return setNickname(threadID, userID, nickname);
  }

  override setGroupName(threadID: string, name: string): Promise<void> {
    return setGroupName(threadID, name);
  }

  override setGroupImage(
    threadID: string,
    imageSource: Buffer | Readable | string,
  ): Promise<void> {
    return setGroupImage(threadID, imageSource);
  }

  override removeGroupImage(threadID: string): Promise<void> {
    return removeGroupImage(threadID);
  }

  override addUserToGroup(threadID: string, userID: string): Promise<void> {
    return addUserToGroup(threadID, userID);
  }

  override removeUserFromGroup(
    threadID: string,
    userID: string,
  ): Promise<void> {
    return removeUserFromGroup(threadID, userID);
  }

  override setGroupReaction(threadID: string, emoji: string): Promise<void> {
    return setGroupReaction(threadID, emoji);
  }

  override reactToMessage(
    threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    return reactToMessage(threadID, messageID, emoji);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createFbPageApi(pageApi: PageApi): UnifiedApi {
  return new FbPageApi(pageApi);
}
