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
import { Platforms } from '@/engine/constants/platform.constants.js';

import type { Context } from 'telegraf';
import type { Readable } from 'stream';
import {
  UnifiedApi,
  type SendPayload,
  type ReplyMessageOptions,
  type UserInfo,
} from '@/engine/adapters/models/api.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';

import { logger } from '@/engine/lib/logger.lib.js';
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

// Database fallbacks for cross-platform unified name resolution
import { getUserName as dbGetUserName } from '@/engine/repos/users.repo.js';
import { getThreadName as dbGetThreadName } from '@/engine/repos/threads.repo.js';

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
    logger.debug('[telegram] sendMessage called', { threadID });
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
    logger.debug('[telegram] unsendMessage called', { messageID });
    return unsendMessage(this.#ctx, messageID);
  }

  override getUserInfo(userIds: string[]): Promise<Record<string, UserInfo>> {
    logger.debug('[telegram] getUserInfo called', { userCount: userIds.length });
    return getUserInfo(this.#ctx, userIds);
  }

  override setGroupName(threadID: string, name: string): Promise<void> {
    logger.debug('[telegram] setGroupName called', { threadID, name });
    return setGroupName(this.#ctx, threadID, name);
  }

  override setGroupImage(
    threadID: string,
    imageSource: Buffer | Readable | string,
  ): Promise<void> {
    logger.debug('[telegram] setGroupImage called', { threadID });
    return setGroupImage(this.#ctx, threadID, imageSource);
  }

  override removeGroupImage(threadID: string): Promise<void> {
    logger.debug('[telegram] removeGroupImage called', { threadID });
    return removeGroupImage(this.#ctx, threadID);
  }

  override removeUserFromGroup(
    threadID: string,
    userID: string,
  ): Promise<void> {
    logger.debug('[telegram] removeUserFromGroup called', { threadID, userID });
    return removeUserFromGroup(this.#ctx, threadID, userID);
  }

  override replyMessage(
    threadID: string,
    opts: ReplyMessageOptions = {},
  ): Promise<unknown> {
    logger.debug('[telegram] replyMessage called', { threadID });
    return replyMessage(this.#ctx, threadID, opts);
  }

  override reactToMessage(
    threadID: string,
    messageID: string,
    emoji: string,
  ): Promise<void> {
    logger.debug('[telegram] reactToMessage called', { threadID, messageID, emoji });
    return reactToMessage(this.#ctx, threadID, messageID, emoji);
  }

  override getBotID(): Promise<string> {
    logger.debug('[telegram] getBotID called');
    return getBotID(this.#ctx);
  }

  override setNickname(
    threadID: string,
    userID: string,
    nickname: string,
  ): Promise<void> {
    logger.debug('[telegram] setNickname called', { threadID, userID });
    return setNickname(this.#ctx, threadID, userID, nickname);
  }

  override editMessage(messageID: string, newBody: string): Promise<void> {
    logger.debug('[telegram] editMessage called', { messageID });
    return editMessage(this.#ctx, messageID, newBody);
  }

  override getFullThreadInfo(threadID: string): Promise<UnifiedThreadInfo> {
    logger.debug('[telegram] getFullThreadInfo called', { threadID });
    return getFullThreadInfo(this.#ctx, threadID);
  }

  override getFullUserInfo(userID: string): Promise<UnifiedUserInfo> {
    logger.debug('[telegram] getFullUserInfo called', { userID });
    return getFullUserInfo(this.#ctx, userID);
  }

  // ── Unsupported stubs ─────────────────────────────────────────────────────

  /**
   * Returns the sender's display name from ctx.from — zero Bot API calls.
   * The Telegram Bot API does not provide a public user profile endpoint, so this method
   * is accurate only when userID matches the current update's sender (ctx.from.id).
   * Any other user ID falls back to a database lookup rather than making a REST call.
   * Callers that need cross-user name resolution should use ctx.user.getInfo() instead.
   */
  override getUserName(userID: string): Promise<string> {
    logger.debug('[telegram] getUserName called (event-first with db fallback)', { userID });
    const from = this.#ctx.from;
    if (from && String(from.id) === userID) {
      // Construct display name from first_name + optional last_name (Bot API convention)
      const lastName = (from as Record<string, unknown>)['last_name'] as string | undefined;
      const parts = [from.first_name, lastName].filter(Boolean);
      const name = parts.length ? parts.join(' ') : from.username;
      if (name) return Promise.resolve(name);
    }
    return dbGetUserName(userID);
  }

  /**
   * Returns the chat title from ctx.chat — zero Bot API calls.
   * Groups/supergroups expose .title; private DM chats expose .first_name (+ optional .last_name).
   * Falls back to database lookup for anonymous or unresolvable chat types.
   */
  override getThreadName(_threadID: string): Promise<string> {
    logger.debug('[telegram] getThreadName called (event-first with db fallback)', { threadID: _threadID });
    const chat = this.#ctx.chat;
    if (!chat) return dbGetThreadName(_threadID);
    // Groups, supergroups, channels all carry .title
    if ('title' in chat && chat.title) return Promise.resolve(chat.title);
    // Private DMs: first_name is always present; last_name and username are optional
    if ('first_name' in chat) {
      const lastName = (chat as Record<string, unknown>)['last_name'] as string | undefined;
      const parts = [chat.first_name, lastName].filter(Boolean);
      const name = parts.length ? parts.join(' ') : ((chat as Record<string, unknown>)['username'] as string | undefined);
      if (name) return Promise.resolve(name);
    }
    return dbGetThreadName(_threadID);
  }
  
  override addUserToGroup(threadID: string, userID: string): Promise<void> {
    logger.debug('[telegram] addUserToGroup called', { threadID, userID });
    return addUserToGroup(threadID, userID);
  }

  override setGroupReaction(threadID: string, emoji: string): Promise<void> {
    logger.debug('[telegram] setGroupReaction called', { threadID, emoji });
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
