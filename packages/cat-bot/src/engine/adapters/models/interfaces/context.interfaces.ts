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
import type { MessageStyleValue } from '@/engine/constants/message-style.constants.js';

/**
 * Options for chat.editMessage().
 */
export interface EditOptions {
  message?: string;
  message_id_to_edit?: string;
  style?: MessageStyleValue;
  /**
   * Flat array → single keyboard row; 2-D array → multiple rows (grid / mixed layout).
   */
  button?: string[] | string[][];
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  threadID?: string;
  thread_id?: string;
}

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
    imageSource:
      | Buffer
      | import('stream').Readable
      | string
      | ({
          imageSource: Buffer | import('stream').Readable | string;
        } & ThreadOptions),
  ): Promise<void>;
  removeImage(options?: ThreadOptions): Promise<void>;
  addUser(userID: string | ({ userID: string } & ThreadOptions)): Promise<void>;
  removeUser(
    userID: string | ({ userID: string } & ThreadOptions),
  ): Promise<void>;
  setReaction(
    emoji: string | ({ emoji: string } & ThreadOptions),
  ): Promise<void>;
  setNickname(
    options: { nickname: string; user_id: string } & ThreadOptions,
  ): Promise<void>;
  getInfo(targetThreadID?: string | ThreadOptions): Promise<UnifiedThreadInfo>;
  /** Returns the display name of this thread/group using cached/in-flight data (Discord/Telegram) or the DB (FB). Falls back to "Thread {id}". */
  getName(targetThreadID?: string | ThreadOptions): Promise<string>;
  /** Returns the real-time member count for this thread/group. Falls back to 0 on unsupported platforms or network error. */
  getMemberCount(targetThreadID?: string | ThreadOptions): Promise<number>;
}

/**
 * Options for chat.reply() and chat.replyMessage().
 */
export interface ReplyOptions {
  message?: string;
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  /**
   * Flat array → single keyboard row; 2-D array → multiple rows (grid / mixed layout).
   */
  button?: string[] | string[][];
  threadID?: string;
  thread_id?: string;
  messageID?: string;
  reply_to_message_id?: string;
  /**
   * Controls how the message text is rendered on the target platform.
   * 'text'     → raw plain text (escapes markdown characters on Discord).
   * 'markdown' → formatted text (MarkdownV2 on Telegram; Unicode styled on FB platforms).
   * Omitting preserves the historic default behavior for each platform.
   */
  style?: MessageStyleValue;
}

/**
 * Chat-scoped context for message operations.
 * Created by createChatContext() and injected as ctx.chat.
 */
export interface ChatContext {
  reply(options?: ReplyOptions): Promise<unknown>;
  replyMessage(options?: ReplyOptions): Promise<unknown>;
  reactMessage(
    options: string | ({ emoji: string } & ThreadOptions & MessageOptions),
  ): Promise<void>;
  unsendMessage(
    options:
      | string
      | ({ targetMessageID?: string; messageID?: string } & MessageOptions),
  ): Promise<void>;
  editMessage(options: EditOptions): Promise<void>;
}

/**
 * Bot-scoped context for bot identity queries.
 * Created by createBotContext() and injected as ctx.bot.
 */
export interface BotContext {
  getID(): Promise<string>;
  /** Makes the bot leave a thread/group. Defaults to the current event's thread when threadID is omitted. */
  leave(threadID?: string): Promise<void>;
}

/**
 * User-scoped context for user information queries.
 * Created by createUserContext() and injected as ctx.user.
 */
export interface UserContext {
  getInfo(userID: string): Promise<UnifiedUserInfo>;
  /** Returns the display name of a user using cached/in-flight data (Discord/Telegram) or the DB (FB). Falls back to "User {id}". */
  getName(userID: string): Promise<string>;
  /** Returns the avatar URL for a user; null when the platform does not expose one or the user has no avatar set. */
  getAvatarUrl(userID: string): Promise<string | null>;
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
      state: string | string[];
      context: Record<string, unknown>;
    }): void;
    delete(id: string): void;
  };
}

/**
 * Context for managing interactive button persistence.
 * Created by createButtonContext() and injected as ctx.button.
 */
export interface ButtonContext {
  button: {
    /**
     * Generates a fully qualified callback ID for an interactive button.
     * Automatically appends the user scope (~senderID) unless public is true.
     *
     * @param options.id - The base button ID (e.g. 'refresh')
     * @param options.public - If true, anyone can click the button. Defaults to false.
     */
    generateID(options: { id: string; public?: boolean }): string;

    /** Stores context data available via ctx.session inside the button's onClick handler. */
    createContext(options: {
      id: string;
      context: Record<string, unknown>;
    }): void;
    getContext(id: string): Record<string, unknown> | null;
    deleteContext(id: string): void;
    /**
     * Dynamically updates an existing button's properties.
     * If the base ID is provided, the change applies globally to all future uses of this button in the command.
     * If a generated ID (from generateID) is provided, the change applies only to that specific button instance.
     */
    update(options: {
      id: string;
      label?: string;
      style?: string;
      onClick?: (...args: unknown[]) => unknown;
    }): void;

    /**
     * Dynamically creates a new button.
     * Same scoping rules as update() apply.
     */
    create(options: {
      id: string;
      label: string;
      style?: string;
      onClick: (...args: unknown[]) => unknown;
    }): void;
  };
}
