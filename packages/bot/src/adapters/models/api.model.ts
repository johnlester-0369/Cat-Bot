/**
 * UnifiedApi — abstract base class and single contract for all platform wrappers.
 *
 * Every platform (Discord, Telegram, Facebook, FB-Page) creates a concrete object
 * that satisfies this interface. Unified command modules call only these methods —
 * never platform-native APIs — so they remain completely platform-agnostic.
 *
 * All methods are async/Promise-based regardless of whether the underlying platform
 * uses callbacks (fca-unofficial) or Promises (discord.js, telegraf).
 *
 * ARCHITECTURE:
 *   - Interfaces  → ./interfaces/ (SendPayload, ButtonItem, etc.)
 *   - Class       → this file (UnifiedApi base class)
 */

import type { Readable } from 'stream'; // Readable used in setGroupImage signature

// Import only what is directly used in method signatures in this file.
// MentionEntry, NamedStreamAttachment, NamedUrlAttachment, ButtonItem are re-exported
// below via `export type { ... } from` so they never need a local import binding.
import type {
  SendPayload,
  UserInfo,
  ReplyMessageOptions,
} from './interfaces/index.js';

// Re-export PlatformId from thread.model so consumers can import from either file.
export type { PlatformId } from './thread.model.js';

// Re-export interfaces for backward compatibility — direct source re-exports avoid
// creating local bindings that ESLint flags as unused under verbatimModuleSyntax.
export type {
  MentionEntry,
  NamedStreamAttachment,
  NamedUrlAttachment,
  ButtonItem,
  UserInfo,
  ReplyMessageOptions,
  SendPayload,
} from './interfaces/index.js'; // SendPayload also re-exported here for backward compat

// Import from leaf models to keep dependency direction: api.model → thread/user, never the reverse
import type { UnifiedThreadInfo } from './thread.model.js';
import type { UnifiedUserInfo } from './user.model.js';

/**
 * UnifiedApi base class — all platform wrappers extend this.
 */
export class UnifiedApi {
  platform: string = 'unknown';

  /**
   * Send a text message or attachment to a thread.
   * @returns Resolves with the sent message ID when the platform returns one.
   */
  async sendMessage(
    _msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    throw new Error(
      `sendMessage not implemented on platform: ${this.platform}`,
    );
  }

  /**
   * Delete a previously sent message.
   */
  async unsendMessage(_messageID: string): Promise<void> {
    throw new Error(
      `unsendMessage is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Edit a previously sent message's body.
   * Only the bot's own messages can be edited, and only within the platform's edit window.
   * Throws by default — override on platforms that expose an edit API (fca, Telegram, Discord).
   */
  async editMessage(_messageID: string, _newBody: string): Promise<void> {
    throw new Error(
      `editMessage is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Fetch display names for an array of user IDs.
   */
  async getUserInfo(_userIds: string[]): Promise<Record<string, UserInfo>> {
    throw new Error(
      `getUserInfo not implemented on platform: ${this.platform}`,
    );
  }

  /**
   * Rename the current group / server / chat.
   * Throws by default — only Discord and Telegram override this.
   * FB-Page and FB-Messenger do not support group renaming via their APIs.
   */
  async setGroupName(_threadID: string, _name: string): Promise<void> {
    throw new Error(
      `setGroupName is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Set the group chat or server image.
   * Accepts a Buffer (raw image), a Readable stream, or a URL string.
   * Default no-op — platforms that support image changes override this.
   */
  async setGroupImage(
    _threadID: string,
    _imageSource: Buffer | Readable | string,
  ): Promise<void> {
    throw new Error(
      `setGroupImage is not supported on platform: ${this.platform}`,
    );
  }

  async reactToMessage(
    _threadID: string,
    _messageID: string,
    _emoji: string,
  ): Promise<void> {
    throw new Error(
      `reactToMessage is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Remove the group chat or server image (set it back to default/no image).
   */
  async removeGroupImage(_threadID: string): Promise<void> {
    throw new Error(
      `removeGroupImage is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Add a user to the group chat or server.
   */
  async addUserToGroup(_threadID: string, _userID: string): Promise<void> {
    throw new Error(
      `addUserToGroup is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Remove (kick) a user from the group chat or server.
   */
  async removeUserFromGroup(_threadID: string, _userID: string): Promise<void> {
    throw new Error(
      `removeUserFromGroup is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Set the group's quick-reaction emoji (the default "like" button emoji).
   * fca-unofficial: maps to api.changeThreadEmoji. Other platforms may not support this.
   */
  async setGroupReaction(_threadID: string, _emoji: string): Promise<void> {
    throw new Error(
      `setGroupReaction is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * FB-Page is always 1:1 and throws not-supported by default.
   */
  async setNickname(
    _threadID: string,
    _userID: string,
    _nickname: string,
  ): Promise<void> {
    throw new Error(
      `setNickname not implemented on platform: ${this.platform}`,
    );
  }

  /**
   * Set a participant's display nickname in the thread.
   * fca-unofficial: api.changeNickname(); Discord: member.setNickname();
   * Telegram: setChatAdministratorCustomTitle (admin members only).
   * reply_to_message_id; others fall back to a plain send.
   */
  async replyMessage(
    _threadID: string,
    _options: ReplyMessageOptions = {},
  ): Promise<unknown> {
    throw new Error(
      `replyMessage is not supported on platform: ${this.platform}`,
    );
  }

  /**
   * Get the unique identifier of the bot/user account on this platform.
   * Used by commands that need to reference the bot itself (e.g., setNickname).
   */
  async getBotID(): Promise<string> {
    throw new Error(`getBotID not implemented on platform: ${this.platform}`); // no params needed
  }

  /**
   * Fetch rich structured information about a thread / group / server.
   *
   * Concept mapping:
   *   Discord      → threadID is a channel ID; enclosing Guild is the "thread"
   *   Telegram     → threadID is the numeric chat ID
   *   FB Messenger → calls fca api.getThreadInfo()
   *   FB Page      → always 1:1; name derived from getUserInfo on the sender
   */
  async getFullThreadInfo(_threadID: string): Promise<UnifiedThreadInfo> {
    throw new Error(
      `getFullThreadInfo not implemented on platform: ${this.platform}`,
    );
  }

  /**
   * Fetch rich structured information about a user on this platform.
   *
   * Concept mapping:
   *   Discord      → REST client.users.fetch() (rate-limited)
   *   Telegram     → getChatMember / ctx.from fallback (no standalone getUser in Bot API)
   *   FB Messenger → fca api.getUserInfo()
   *   FB Page      → Graph API GET /{userID}?fields=name
   */
  async getFullUserInfo(_userID: string): Promise<UnifiedUserInfo> {
    throw new Error(
      `getFullUserInfo not implemented on platform: ${this.platform}`,
    );
  }
}
