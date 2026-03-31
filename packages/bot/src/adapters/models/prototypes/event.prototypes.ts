/**
 * Cat-Bot — Event Prototype Objects
 *
 * Frozen canonical shapes for every event variant.
 * Each PROTO_EVENT_* object documents every key a handler may safely read.
 * Extracted from event.model.ts for single-responsibility.
 *
 * These prototypes serve as:
 *   1. Reference documentation for event shapes
 *   2. Type-safe templates for test fixtures
 *   3. Runtime guards via structural comparison
 */

import { EventType } from '../enums/index.js';

// ── typ (typing indicator) ───────────────────────────────────────────────────

export const PROTO_EVENT_TYP = Object.freeze({
  type: EventType.TYP,
  isTyping: false,
  /** The user who is (or stopped) typing — senderID as string. */
  from: '',
  threadID: '',
});

// ── presence ──────────────────────────────────────────────────────────────────

export const PROTO_EVENT_PRESENCE = Object.freeze({
  type: EventType.PRESENCE,
  userID: '',
  /** Unix timestamp in milliseconds (data["l"] * 1000). */
  timestamp: 0,
  /** Raw `p` field from the MQTT /orca_presence payload. */
  statuses: null as unknown,
});

// ── message ───────────────────────────────────────────────────────────────────

export const PROTO_EVENT_MESSAGE = Object.freeze({
  type: EventType.MESSAGE,
  senderID: '',
  message: '',
  threadID: '',
  messageID: '',
  /** Array of PROTO_ATTACHMENT_* shaped objects; empty when text-only. */
  attachments: [] as unknown[],
  /** { [userID: string]: mentionedText } */
  mentions: {} as Record<string, string>,
  /** String ms timestamp from fca; may be number on other platforms. */
  timestamp: null as string | number | null,
  isGroup: false,
});

// ── message_reply ─────────────────────────────────────────────────────────────

/** Inner shape of PROTO_EVENT_MESSAGE_REPLY.messageReply. */
export const PROTO_REPLIED_MESSAGE = Object.freeze({
  threadID: '',
  messageID: '',
  senderID: '',
  attachments: [] as unknown[],
  /** body split on /\s+/ — pre-tokenized for command parsing. */
  args: [] as string[],
  message: '',
  isGroup: false,
  mentions: {} as Record<string, string>,
  /** Number ms timestamp (unlike outer message which uses string). */
  timestamp: 0,
});

export const PROTO_EVENT_MESSAGE_REPLY = Object.freeze({
  type: EventType.MESSAGE_REPLY,
  threadID: '',
  messageID: '',
  senderID: '',
  attachments: [] as unknown[],
  args: [] as string[],
  /** Unified message content — renamed from 'body' for consistency. */
  message: '',
  isGroup: false,
  mentions: {} as Record<string, string>,
  timestamp: 0,
  /** The message being replied to; null if fetch failed. */
  messageReply: PROTO_REPLIED_MESSAGE as typeof PROTO_REPLIED_MESSAGE | null,
});

// ── message_reaction ─────────────────────────────────────────────────────────

export const PROTO_EVENT_MESSAGE_REACTION = Object.freeze({
  type: EventType.MESSAGE_REACTION,
  threadID: '',
  messageID: '',
  /** The emoji string placed on the message, e.g. "❤". */
  reaction: '',
  /** Who placed the reaction. */
  senderID: '',
  /** Whose message received the reaction. */
  userID: '',
  /** Unix ms timestamp when the reaction was set; null when platform does not surface it. */
  timestamp: null as number | null,
  /** fca-unofficial offline threading ID; empty string on non-Messenger platforms. */
  offlineThreadingID: '',
});

// ── message_unsend ────────────────────────────────────────────────────────────

export const PROTO_EVENT_MESSAGE_UNSEND = Object.freeze({
  type: EventType.MESSAGE_UNSEND,
  threadID: '',
  messageID: '',
  senderID: '',
  deletionTimestamp: 0,
  /**
   * The original send timestamp — undefined in practice; preserved as-is
   * because consumers may want to distinguish "no timestamp" from timestamp=0.
   */
  timestamp: undefined as number | undefined,
});

// ── read_receipt ──────────────────────────────────────────────────────────────

export const PROTO_EVENT_READ_RECEIPT = Object.freeze({
  type: EventType.READ_RECEIPT,
  /** userID of who read the messages. */
  reader: '',
  /** actionTimestampMs. */
  time: 0,
  threadID: '',
});

// ── read ──────────────────────────────────────────────────────────────────────

export const PROTO_EVENT_READ = Object.freeze({
  type: EventType.READ,
  threadID: '',
  time: 0,
});

// ── event (thread administrative events) ─────────────────────────────────────

/**
 * Shape of each entry in PROTO_LOG_DATA_SUBSCRIBE.addedParticipants[].
 * Mirrors the raw Facebook delta payload for ParticipantsAddedToGroupThread.
 */
export const PROTO_ADDED_PARTICIPANT = Object.freeze({
  fanoutPolicy: '',
  firstName: '',
  fullName: '',
  /** e.g. "MEMBER" */
  groupJoinStatus: '',
  /** e.g. "FOLDER_INBOX" */
  initialFolder: '',
  /** { systemFolderId: "INBOX" } */
  initialFolderId: null as { systemFolderId: string } | null,
  /** Unix ms timestamp as string. */
  lastUnsubscribeTimestampMs: '',
  userFbId: '',
  isMessengerUser: false,
});

/**
 * logMessageData shapes keyed by LogMessageType:
 *
 *   log:user-nickname    → { nickname: string, participant_id: string }
 *   log:thread-name      → { name: string }
 *   log:subscribe        → { addedParticipants: PROTO_ADDED_PARTICIPANT[] }
 *   log:unsubscribe      → { leftParticipantFbId: string }
 *   log:thread-color     → raw untypedData object (varies)
 *   log:thread-icon      → raw untypedData object (varies)
 *   log:thread-image     → { image: { attachmentID, width, height, url } }
 *   change_thread_admins → { TARGET_ID: string, ADMIN_TYPE: string }
 *   group_poll           → raw untypedData object (varies)
 *   messenger_call_log   → raw untypedData object (varies)
 */
export const PROTO_EVENT_THREAD_EVENT = Object.freeze({
  type: EventType.EVENT,
  threadID: '',
  /** One of LogMessageType values. */
  logMessageType: '',
  /** Varies per logMessageType — see JSDoc above. */
  logMessageData: null as Record<string, unknown> | null,
  /** Human-readable English description, e.g. "Elle named the group …". */
  logMessageBody: '',
  /** userID of the actor who triggered this event. */
  author: '',
});

// ── ready ─────────────────────────────────────────────────────────────────────

export const PROTO_EVENT_READY = Object.freeze({
  type: EventType.READY,
  error: null as unknown,
});

// ── stop_listen ───────────────────────────────────────────────────────────────

export const PROTO_EVENT_STOP_LISTEN = Object.freeze({
  type: EventType.STOP_LISTEN,
  error: '',
});

// ── parse_error ───────────────────────────────────────────────────────────────

export const PROTO_EVENT_PARSE_ERROR = Object.freeze({
  type: EventType.PARSE_ERROR,
  error: '',
  /** The original exception object. */
  detail: null as unknown,
  /** The raw unparsable payload for debugging. */
  res: null as unknown,
});

// ── button_action ─────────────────────────────────────────────────────────────

export const PROTO_EVENT_BUTTON_ACTION = Object.freeze({
  type: EventType.BUTTON_ACTION,
  /** Source platform identifier — matches platform wrappers' this.platform value. */
  platform: '',
  threadID: '',
  /** Platform user ID of the person who clicked the button. */
  senderID: '',
  /** ID of the message that contained the button. */
  messageID: '',
  /** Fully-qualified action ID in "commandName:actionId" format. */
  actionId: '',
  timestamp: null as number | null,
});
