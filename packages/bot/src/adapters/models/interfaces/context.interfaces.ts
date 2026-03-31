/**
 * Cat-Bot — Context Interfaces
 *
 * Type definitions for command execution context objects.
 * Extracted from context.model.ts for single-responsibility.
 *
 * These interfaces define the shape of context objects injected into commands:
 *   - ThreadContext: Group/server operations
 *   - ChatContext: Message send/react/unsend
 *   - BotContext: Bot identity queries
 *   - UserContext: User info queries
 *   - StateContext: Pending reply/react state management
 */

import type {
  NamedStreamAttachment,
  NamedUrlAttachment,
} from './api.interfaces.js';
import type { UnifiedThreadInfo } from '../thread.model.js';
import type { UnifiedUserInfo } from '../user.model.js';

/**
 * Thread-scoped context for group/server operations.
 * Created by createThreadContext() and injected as ctx.thread.
 */
export interface ThreadContext {
  setName(name: string): Promise<void>;
  setImage(
    imageSource: Buffer | import('stream').Readable | string,
  ): Promise<void>;
  removeImage(): Promise<void>;
  addUser(userID: string): Promise<void>;
  removeUser(userID: string): Promise<void>;
  setReaction(emoji: string): Promise<void>;
  setNickname(options: { nickname: string; user_id: string }): Promise<void>;
  getInfo(targetThreadID?: string): Promise<UnifiedThreadInfo>;
}

/**
 * Options for chat.reply() and chat.replyMessage().
 */
export interface ReplyOptions {
  message?: string;
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  button?: string[];
}

/**
 * Chat-scoped context for message operations.
 * Created by createChatContext() and injected as ctx.chat.
 */
export interface ChatContext {
  reply(options?: ReplyOptions): Promise<unknown>;
  replyMessage(options?: ReplyOptions): Promise<unknown>;
  reactMessage(emoji: string): Promise<void>;
  unsendMessage(targetMessageID: string): Promise<void>;
}

/**
 * Bot-scoped context for bot identity queries.
 * Created by createBotContext() and injected as ctx.bot.
 */
export interface BotContext {
  getID(): Promise<string>;
}

/**
 * User-scoped context for user information queries.
 * Created by createUserContext() and injected as ctx.user.
 */
export interface UserContext {
  getInfo(userID: string): Promise<UnifiedUserInfo>;
}

/**
 * State management context for pending flows.
 * Created by createStateContext() and injected as ctx.state.
 */
export interface StateContext {
  state: {
    generateID(options: { id: string; public?: boolean }): string;
    create(options: {
      id: string;
      state: string;
      context: Record<string, unknown>;
    }): void;
    delete(id: string): void;
  };
}
