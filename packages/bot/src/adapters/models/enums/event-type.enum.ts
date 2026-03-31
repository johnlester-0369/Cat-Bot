/**
 * Cat-Bot — Event Type Enumeration
 *
 * Discriminant strings for the top-level `type` field on every event object.
 * Extracted from event.model.ts for single-responsibility and independent consumption.
 *
 * Platforms normalise their native events into these canonical types before
 * passing them to the handler layer.
 */

export const EventType = Object.freeze({
  /** Standard chat message — text, attachments, or both. */
  MESSAGE: 'message',

  /** Reply to a specific earlier message in the thread. */
  MESSAGE_REPLY: 'message_reply',

  /** Emoji reaction added to a message. */
  MESSAGE_REACTION: 'message_reaction',

  /** A sent message was retracted by its sender. */
  MESSAGE_UNSEND: 'message_unsend',

  /** Typing indicator — someone started or stopped typing. */
  TYP: 'typ',

  /** Online / last-active presence update for a user. */
  PRESENCE: 'presence',

  /**
   * Thread-level administrative event: rename, nickname change, member
   * add/remove, theme change, poll, call log, etc.
   * Variant is narrowed via the `logMessageType` field.
   */
  EVENT: 'event',

  /** Another participant read up to this point in the conversation. */
  READ_RECEIPT: 'read_receipt',

  /** The local user marked a thread as read. */
  READ: 'read',

  /**
   * MQTT sync is ready and the first /t_ms delta has been received.
   * Emitted only when ctx.globalOptions.emitReady === true.
   */
  READY: 'ready',

  /** The MQTT connection was deliberately stopped. */
  STOP_LISTEN: 'stop_listen',

  /** An incoming delta could not be parsed into a known event shape. */
  PARSE_ERROR: 'parse_error',

  /**
   * A user clicked an interactive button attached to a bot message.
   * Emitted by Discord (isButton interaction), Telegram (callback_query),
   * and Facebook Page (postback webhook field).
   */
  BUTTON_ACTION: 'button_action',
} as const);

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];
