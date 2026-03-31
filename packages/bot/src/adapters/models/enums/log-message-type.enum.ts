/**
 * Cat-Bot — Log Message Type Enumeration
 *
 * Discriminant strings for the `logMessageType` field on EventType.EVENT objects.
 * Extracted from event.model.ts for single-responsibility and independent consumption.
 *
 * These values identify thread-level administrative events emitted by
 * Facebook Messenger (fca-unofficial) and normalised by other platforms.
 */

export const LogMessageType = Object.freeze({
  // ── Member membership ────────────────────────────────────────────────────
  /** One or more users were added to the group. */
  SUBSCRIBE: 'log:subscribe',

  /** A user was removed or left the group. */
  UNSUBSCRIBE: 'log:unsubscribe',

  // ── Group metadata ────────────────────────────────────────────────────────
  /** The conversation / group name was changed. */
  THREAD_NAME: 'log:thread-name',

  /** The group theme colour was changed. */
  THREAD_COLOR: 'log:thread-color',

  /** The group emoji icon was changed. */
  THREAD_ICON: 'log:thread-icon',

  /** The group photo was changed or removed. */
  THREAD_IMAGE: 'log:thread-image',

  // ── Nicknames ─────────────────────────────────────────────────────────────
  /** A participant's nickname inside this thread was set or cleared. */
  USER_NICKNAME: 'log:user-nickname',

  // ── Admin / moderation ────────────────────────────────────────────────────
  /** A participant's admin status in the group was changed. */
  CHANGE_THREAD_ADMINS: 'change_thread_admins',

  /** The group's approval mode for join requests was changed. */
  CHANGE_THREAD_APPROVAL_MODE: 'change_thread_approval_mode',

  // ── Engagement ───────────────────────────────────────────────────────────
  /** A poll was created or updated in the thread. */
  GROUP_POLL: 'group_poll',

  // ── Calls ─────────────────────────────────────────────────────────────────
  /** A Messenger call was placed, missed, or ended. */
  MESSENGER_CALL_LOG: 'messenger_call_log',

  /** A participant joined an active group call. */
  PARTICIPANT_JOINED_GROUP_CALL: 'participant_joined_group_call',

  // ── Misc ──────────────────────────────────────────────────────────────────
  MAGIC_WORDS: 'magic_words',
  JOINABLE_GROUP_LINK_MODE_CHANGE: 'joinable_group_link_mode_change',
  GENERIC_ADMIN_TEXT: 'log:generic-admin-text',
} as const);

export type LogMessageTypeValue =
  (typeof LogMessageType)[keyof typeof LogMessageType];
