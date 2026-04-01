/**
 * Telegram Platform Wrapper
 *
 * Pure wiring layer — the class shell delegates every UnifiedApi method to its
 * corresponding lib/<method>.ts module. No business logic lives here.
 *
 * Architecture:
 *   lib/        — individual method implementations (each independently testable)
 *   utils/      — event normalisation utilities
 *   unsupported — stubs for operations the Bot API does not support
 *
 * NOTE: Previous version re-exported normalizers from utils/helper.util.js for
 * index.ts convenience. That coupling is removed — handlers.ts imports
 * normalizers directly from utils/, keeping wrapper's responsibility to the
 * UnifiedApi class shell only.
 */
import { Platforms } from '@/constants/platform.constants.js';

import type { Context } from 'telegraf';
import type { Readable } from 'stream';
import {
  UnifiedApi,
  type SendPayload,
  type ReplyMessageOptions,
  type UserInfo,
} from '@/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/adapters/models/user.model.js';

// buildTelegramMentionEntities translates {tag, user_id} entries to Bot API text_mention entity format
import { buildTelegramMentionEntities } from './utils/helper.util.js';

// ── Method lib imports ────────────────────────────────────────────────────────
import { sendMessage } from './lib/sendMessage.js';
import { unsendMessage } from './lib/unsendMessage.js';
import { getUserInfo } from './lib/getUserInfo.js';
import { setGroupName } from './lib/setGroupName.js';
import { setGroupImage } from './lib/setGroupImage.js';
import { removeGroupImage } from './lib/removeGroupImage.js';
import { removeUserFromGroup } from './lib/removeUserFromGroup.js';
import { replyMessage } from './lib/replyMessage.js';
import { reactToMessage } from './lib/reactToMessage.js';
import { getBotID } from './lib/getBotID.js';
import { setNickname } from './lib/setNickname.js';
import { editMessage } from './lib/editMessage.js';
import { getFullThreadInfo } from './lib/getFullThreadInfo.js';
import { getFullUserInfo } from './lib/getFullUserInfo.js';
import { addUserToGroup, setGroupReaction } from './unsupported.js';

// ── Class shell ───────────────────────────────────────────────────────────────

class TelegramApi extends UnifiedApi {
  readonly #ctx: Context;

  constructor(ctx: Context) {
    super();
    this.platform = Platforms.Telegram;
    this.#ctx = ctx;
  }

  // ── Implemented methods ───────────────────────────────────────────────────

  override sendMessage(
    msg: string | SendPayload,
    threadID: string,
  ): Promise<string | undefined> {
    // When text-only mentions are present, bypass the lib to inject text_mention entities directly
    // into the Bot API request. text_mention type tags users by their numeric ID even without a
    // public @username. We fall through to the lib for attachment sends so its media-type routing
    // (sendPhoto, sendVoice, etc.) remains authoritative for non-text payloads.
    if (
      typeof msg !== 'string' &&
      Array.isArray(msg.mentions) &&
      msg.mentions.length > 0 &&
      !msg.attachment &&
      !msg.attachment_url?.length
    ) {
      const text = String(msg.message ?? msg.body ?? '');
      const chatId = Number(threadID) || this.#ctx.chat?.id;
      const entities = buildTelegramMentionEntities(text, msg.mentions);
      return this.#ctx.telegram
        .sendMessage(
          chatId as number,
          text || ' ',
          entities.length
            ? { entities: entities as import('telegraf/types').MessageEntity[] }
            : undefined,
        )
        .then((m) => String(m.message_id));
    }
    return sendMessage(this.#ctx, msg, threadID);
  }

  override unsendMessage(messageID: string): Promise<void> {
    return unsendMessage(this.#ctx, messageID);
  }

  override getUserInfo(userIds: string[]): Promise<Record<string, UserInfo>> {
    return getUserInfo(this.#ctx, userIds);
  }

  override setGroupName(threadID: string, name: string): Promise<void> {
    return setGroupName(this.#ctx, threadID, name);
  }

  override setGroupImage(
    threadID: string,
    imageSource: Buffer | Readable | string,
  ): Promise<void> {
    return setGroupImage(this.#ctx, threadID, imageSource);
  }

  override removeGroupImage(threadID: string): Promise<void> {
    return removeGroupImage(this.#ctx, threadID);
  }

  override removeUserFromGroup(
    threadID: string,
    userID: string,
  ): Promise<void> {
    return removeUserFromGroup(this.#ctx, threadID, userID);
  }

  override replyMessage(
    threadID: string,
    opts: ReplyMessageOptions = {},
  ): Promise<unknown> {
    return replyMessage(this.#ctx, threadID, opts);
  }

  override reactToMessage(
    threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    return reactToMessage(this.#ctx, threadID, messageID, emoji);
  }

  override getBotID(): Promise<string> {
    return getBotID(this.#ctx);
  }

  override setNickname(
    threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    return setNickname(this.#ctx, threadID, userID, nickname);
  }

  override editMessage(messageID: string, newBody: string): Promise<void> {
    return editMessage(this.#ctx, messageID, newBody);
  }

  override getFullThreadInfo(threadID: string): Promise<UnifiedThreadInfo> {
    return getFullThreadInfo(this.#ctx, threadID);
  }

  override getFullUserInfo(userID: string): Promise<UnifiedUserInfo> {
    return getFullUserInfo(this.#ctx, userID);
  }

  // ── Unsupported stubs ─────────────────────────────────────────────────────

  override addUserToGroup(threadID: string, userID: string): Promise<void> {
    return addUserToGroup(threadID, userID);
  }

  override setGroupReaction(threadID: string, emoji: string): Promise<void> {
    return setGroupReaction(threadID, emoji);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a TelegramApi instance bound to the current Telegraf context.
 * Returns UnifiedApi so callers depend only on the abstract contract.
 */
export function createTelegramApi(ctx: Context): UnifiedApi {
  return new TelegramApi(ctx);
}
