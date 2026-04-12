/**
 * Cat-Bot — API Interfaces
 *
 * Core type definitions for the UnifiedApi contract.
 * Extracted from api.model.ts for single-responsibility.
 *
 * These interfaces define the data shapes that flow through the API layer:
 *   - MentionEntry: @mentions in message bodies
 *   - NamedStreamAttachment: File attachments with readable streams
 *   - NamedUrlAttachment: URL-based attachments to be downloaded
 *   - UserInfo: Minimal user display information
 *   - ButtonItem: Interactive button definitions
 */

import type { Readable } from 'stream';

// Re-export PlatformId from thread.model so consumers can import from either file.
// Defined in thread.model (leaf) to avoid circular dependency: api ← thread ← api.
export type { PlatformId } from '../thread.model.js';

import type { ButtonStyleValue } from '@/engine/constants/button-style.constants.js';

import type { MessageStyleValue } from '@/engine/constants/message-style.constants.js';

/**
 * A mention placeholder embedded in a message body.
 * Each platform adapter translates the tag+user_id pair to its native mention format.
 */
export interface MentionEntry {
  /** The placeholder text in the message body, e.g. '@Sender'. */
  tag: string;
  /** Platform user ID of the person being mentioned. */
  user_id: string;
}

/**
 * Named attachment stream — used in attachment[] arrays.
 * `name` sets the download filename; stream carries the binary content.
 */
export interface NamedStreamAttachment {
  name: string;
  stream: Readable | Buffer;
}

/**
 * Named URL attachment — downloaded by the platform wrapper before sending.
 * `name` sets the download filename so MIME detection derives from the extension.
 */
export interface NamedUrlAttachment {
  name: string;
  url: string;
}

/**
 * Minimal user display info returned by getUserInfo().
 * Use getFullUserInfo() for the richer UnifiedUserInfo shape.
 */
export interface UserInfo {
  name: string;
}

/**
 * Resolved button definition passed to platform replyMessage implementations.
 * Produced by createChatContext.resolveButtons() from the command's menu export —
 * callers never construct this directly; they pass bare action ID strings to chat.reply().
 */
export interface ButtonItem {
  /** Fully-qualified callback ID: "commandName:actionId". */
  id: string;
  /** Display label shown on the button face. */
  label: string;
  /**
   * Visual style hint from ButtonStyle.
   * Only meaningful on Discord; other platforms ignore it.
   */
  style?: ButtonStyleValue;
}

/**
 * Payload accepted by sendMessage() and replyMessage().
 * Platforms that do not support a given field silently ignore it.
 */
export interface SendPayload {
  /** Text content (fca-native key). */
  body?: string;
  /** Text content (unified key; preferred over body). */
  message?: string;
  /** Mention entries; each platform adapter translates to its native format. */
  mentions?: MentionEntry[];
  /**
   * Single stream (fca-native) OR named-stream array (unified).
   * Platform wrappers normalise whichever form they receive.
   */
  attachment?: Readable | NamedStreamAttachment[];
  /** Named URL array; downloaded before send by the platform wrapper. */
  attachment_url?: NamedUrlAttachment[];
}

/**
 * Options accepted by editMessage().
 * Aligns closely with ReplyMessageOptions, scoped for editing payloads.
 */
export interface EditMessageOptions {
  message?: string | SendPayload;
  message_id_to_edit?: string;
  style?: MessageStyleValue;
  button?: ButtonItem[];
  /** Stream-based file attachments added to the edited message — uploaded by the platform wrapper (mirroring replyMessage attachment handling). */
  attachment?: NamedStreamAttachment[];
  /** URL-based file attachments — downloaded by the platform wrapper before upload; used to replace or augment message media. */
  attachment_url?: NamedUrlAttachment[];
  /** Thread ID implicitly injected by chat.editMessage for fallback use by platforms that do not support native editing. */
  threadID?: string;
}

/**
 * Options accepted by replyMessage().
 */
export interface ReplyMessageOptions {
  message?: string | SendPayload;
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  /** ID of the message to thread this reply under. */
  reply_to_message_id?: string;
  /** Resolved button definitions built by createChatContext. */
  button?: ButtonItem[];
  mentions?: MentionEntry[];
  /**
   * Controls how the message text is rendered.
   * 'text'     → raw plain text; markdown syntax is escaped / not applied.
   * 'markdown' → formatted text; each platform uses its native mechanism.
   * Omitting this field preserves the historic default for that platform.
   */
  style?: MessageStyleValue;
}
