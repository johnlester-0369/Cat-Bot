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

/** Shared thread override options for context functions */
export interface ThreadOptions {
  threadID?: string;
  thread_id?: string;
}

/** Shared message override options for context functions */
export interface MessageOptions {
  messageID?: string;
  reply_to_message_id?: string;
}

/**
 * Thread-scoped context for group/server operations.
 * Created by createThreadContext() and injected as ctx.thread.
 */
export interface ThreadContext {
  setName(name: string | ({ name: string } & ThreadOptions)): Promise<void>;
  setImage(
    imageSource: Buffer | import('stream').Readable | string | ({ imageSource: Buffer | import('stream').Readable | string } & ThreadOptions),
  ): Promise<void>;
  removeImage(options?: ThreadOptions): Promise<void>;
  addUser(userID: string | ({ userID: string } & ThreadOptions)): Promise<void>;
  removeUser(userID: string | ({ userID: string } & ThreadOptions)): Promise<void>;
  setReaction(emoji: string | ({ emoji: string } & ThreadOptions)): Promise<void>;
  setNickname(options: { nickname: string; user_id: string } & ThreadOptions): Promise<void>;
  getInfo(targetThreadID?: string | ThreadOptions): Promise<UnifiedThreadInfo>;
  /** Returns the display name of this thread/group using cached/in-flight data (Discord/Telegram) or the DB (FB). Falls back to "Thread {id}". */
  getName(targetThreadID?: string | ThreadOptions): Promise<string>;
}

/**
 * Options for chat.reply() and chat.replyMessage().
 */
export interface ReplyOptions {
  message?: string;
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  button?: string[];
  threadID?: string;
  thread_id?: string;
  messageID?: string;
  reply_to_message_id?: string;
}

/**
 * Chat-scoped context for message operations.
 * Created by createChatContext() and injected as ctx.chat.
 */
export interface ChatContext {
  reply(options?: ReplyOptions): Promise<unknown>;
  replyMessage(options?: ReplyOptions): Promise<unknown>;
  reactMessage(options: string | ({ emoji: string } & ThreadOptions & MessageOptions)): Promise<void>;
  unsendMessage(options: string | ({ targetMessageID?: string; messageID?: string } & MessageOptions)): Promise<void>;
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
  /** Returns the display name of a user using cached/in-flight data (Discord/Telegram) or the DB (FB). Falls back to "User {id}". */
  getName(userID: string): Promise<string>;
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
