/**
 * Cat-Bot — Unified Event Contract
 *
 * Single source of truth for every event shape that crosses the handler layer.
 * Currently derived from fca-unofficial (Facebook Messenger MQTT) — the reference
 * implementation. Other platforms (Discord, Telegram, FB-Page) must normalize
 * their native events into these shapes before passing them to the handler layer.
 *
 * ARCHITECTURE:
 *   - Enumerations → ./enums/ (EventType, AttachmentType, LogMessageType)
 *   - Prototypes   → ./prototypes/ (PROTO_ATTACHMENT_*, PROTO_EVENT_*)
 *   - Factory      → this file (formatEvent())
 *
 * This file re-exports everything for backward compatibility and provides
 * the formatEvent() normalizer that enforces the contract at runtime.
 */

// ── Re-export enums for backward compatibility ────────────────────────────────
export * from './enums/index.js';

// ── Re-export prototypes for backward compatibility ───────────────────────────
export * from './prototypes/index.js';

// ── Local imports for formatEvent() implementation ────────────────────────────
// AttachmentType is re-exported via ./enums/index.js barrel but not used locally here.
import { EventType, LogMessageType } from './enums/index.js';
import { logger } from '@/engine/lib/logger.lib.js';

// ── Re-export types needed for UnifiedEvent union ─────────────────────────────
export type {
  AttachmentTypeValue,
  EventTypeValue,
  LogMessageTypeValue,
} from './enums/index.js';

// ============================================================================
// EXPLICIT INTERFACES — UnifiedEvent members
// Defined as interfaces rather than `typeof PROTO_*` so that runtime-widened
// values (string, boolean, number) are assignable. `typeof PROTO_*` narrows
// all frozen literal fields to "" | false | 0, breaking formatEvent() returns.
// ============================================================================

interface EventMessage {
  type: 'message';
  senderID: string;
  message: string;
  threadID: string;
  messageID: string;
  attachments: unknown[];
  mentions: Record<string, string>;
  timestamp: string | number | null;
  isGroup: boolean;
}
interface EventMessageReply {
  type: 'message_reply';
  threadID: string;
  messageID: string;
  senderID: string;
  attachments: unknown[];
  args: string[];
  message: string;
  isGroup: boolean;
  mentions: Record<string, string>;
  timestamp: number | null;
  messageReply: {
    threadID: string;
    messageID: string;
    senderID: string;
    attachments: unknown[];
    args: string[];
    message: string;
    isGroup: boolean;
    mentions: Record<string, string>;
    timestamp: number;
  } | null;
}
interface EventMessageReaction {
  type: 'message_reaction';
  threadID: string;
  messageID: string;
  reaction: string;
  senderID: string;
  userID: string;
  timestamp: number | null;
  offlineThreadingID: string;
}
interface EventMessageUnsend {
  type: 'message_unsend';
  threadID: string;
  messageID: string;
  senderID: string;
  deletionTimestamp: number;
  timestamp: number | undefined;
}
interface EventTyp {
  type: 'typ';
  isTyping: boolean;
  from: string;
  threadID: string;
}
interface EventPresence {
  type: 'presence';
  userID: string;
  timestamp: number | null;
  statuses: unknown;
}
interface EventThread {
  type: 'event';
  threadID: string;
  logMessageType: string;
  logMessageData: Record<string, unknown> | null;
  logMessageBody: string;
  timestamp: number | null;
  author: string;
}
interface EventReadReceipt {
  type: 'read_receipt';
  reader: string;
  time: number | null;
  threadID: string;
}
interface EventRead {
  type: 'read';
  threadID: string;
  time: number | null;
}
interface EventReady {
  type: 'ready';
  error: unknown;
}
interface EventStopListen {
  type: 'stop_listen';
  error: string;
}
interface EventParseError {
  type: 'parse_error';
  error: string;
  detail: unknown;
  res: unknown;
}
interface EventButtonAction {
  type: 'button_action';
  platform: string;
  threadID: string;
  senderID: string;
  messageID: string;
  actionId: string;
  timestamp: number | null;
}

// Discriminated union — handlers narrow on the `type` field.
// Record<string, unknown> passthrough ensures unknown platform events don't silently drop.
export type UnifiedEvent =
  | EventMessage
  | EventMessageReply
  | EventMessageReaction
  | EventMessageUnsend
  | EventTyp
  | EventPresence
  | EventThread
  | EventReadReceipt
  | EventRead
  | EventReady
  | EventStopListen
  | EventParseError
  | EventButtonAction
  | Record<string, unknown>;

// ============================================================================
// NORMALIZER — formatEvent()
// ============================================================================

/**
 * Normalizes any raw platform event into the unified Cat-Bot event contract.
 *
 * For fca-unofficial (Facebook) events the raw object already matches the
 * prototype shapes — this function is a structural pass-through that ensures
 * every expected key exists even when the source omits it (null-safety).
 *
 * Other platforms must adapt their native event shape to use the correct
 * EventType string BEFORE calling formatEvent(); the switch dispatch is on
 * `event.type`, which must already be one of the EventType enum values.
 */
export function formatEvent(event: Record<string, unknown>): UnifiedEvent {
  logger.debug('[event.model] formatEvent called', { type: event['type'] });
  switch (event['type']) {
    case EventType.MESSAGE:
      return {
        type: event['type'],
        senderID: (event['senderID'] as string) ?? '',
        message:
          (event['message'] as string) ?? (event['body'] as string) ?? '',
        threadID: (event['threadID'] as string) ?? '',
        messageID: (event['messageID'] as string) ?? '',
        attachments: (event['attachments'] as unknown[]) ?? [],
        mentions: (event['mentions'] as Record<string, string>) ?? {},
        timestamp: (event['timestamp'] as string | number | null) ?? null,
        isGroup: (event['isGroup'] as boolean) ?? false,
      };

    case EventType.MESSAGE_REPLY: {
      const reply = event['messageReply'] as
        | Record<string, unknown>
        | undefined;
      return {
        type: event['type'],
        threadID: (event['threadID'] as string) ?? '',
        messageID: (event['messageID'] as string) ?? '',
        senderID: (event['senderID'] as string) ?? '',
        attachments: (event['attachments'] as unknown[]) ?? [],
        args: (event['args'] as string[]) ?? [],
        message:
          (event['message'] as string) ?? (event['body'] as string) ?? '',
        isGroup: (event['isGroup'] as boolean) ?? false,
        mentions: (event['mentions'] as Record<string, string>) ?? {},
        timestamp: (event['timestamp'] as number | null) ?? null,
        // Normalize the inner replied-to message with the same defensive approach
        messageReply: reply
          ? {
              threadID: (reply['threadID'] as string) ?? '',
              messageID: (reply['messageID'] as string) ?? '',
              senderID: (reply['senderID'] as string) ?? '',
              attachments: (reply['attachments'] as unknown[]) ?? [],
              args: (reply['args'] as string[]) ?? [],
              message:
                (reply['message'] as string) ?? (reply['body'] as string) ?? '',
              isGroup: (reply['isGroup'] as boolean) ?? false,
              mentions: (reply['mentions'] as Record<string, string>) ?? {},
              timestamp: (reply['timestamp'] as number) ?? null,
            }
          : null,
      };
    }

    case EventType.MESSAGE_REACTION:
      return {
        type: event['type'],
        threadID: (event['threadID'] as string) ?? '',
        messageID: (event['messageID'] as string) ?? '',
        reaction: (event['reaction'] as string) ?? '',
        senderID: (event['senderID'] as string) ?? '',
        userID: (event['userID'] as string) ?? '',
        timestamp: (event['timestamp'] as number | null) ?? null,
        offlineThreadingID: (event['offlineThreadingID'] as string) ?? '',
      };

    // message_unsend: fca-unofficial emits this when a sender retracts a message
    case EventType.MESSAGE_UNSEND:
      return {
        type: event['type'],
        threadID: (event['threadID'] as string) ?? '',
        messageID: (event['messageID'] as string) ?? '',
        senderID: (event['senderID'] as string) ?? '',
        deletionTimestamp: (event['deletionTimestamp'] as number) ?? null,
        // Intentional: preserve the undefined sentinel that fca-unofficial emits
        // so consumers can distinguish "timestamp not sent" from timestamp === 0
        timestamp: event['timestamp'] as number | undefined,
      };

    case EventType.TYP:
      return {
        type: event['type'],
        isTyping: (event['isTyping'] as boolean) ?? false,
        from: (event['from'] as string) ?? '',
        threadID: (event['threadID'] as string) ?? '',
      };

    case EventType.PRESENCE:
      return {
        type: event['type'],
        userID: (event['userID'] as string) ?? '',
        timestamp: (event['timestamp'] as number | null) ?? null,
        statuses: event['statuses'] ?? null,
      };

    case EventType.EVENT:
      return {
        type: event['type'],
        threadID: (event['threadID'] as string) ?? '',
        logMessageType: (event['logMessageType'] as string) ?? '',
        logMessageData:
          (event['logMessageData'] as Record<string, unknown> | null) ?? null,
        logMessageBody: (event['logMessageBody'] as string) ?? '',
        author: (event['author'] as string) ?? '',
      };

    case 'change_thread_image': {
      // fca-unofficial emits change_thread_image as a standalone top-level type;
      // fold it into EventType.EVENT + logMessageType 'log:thread-image' so handlers
      // subscribe via eventModules.get('log:thread-image') — same dispatch path as all
      // other thread administrative events; no special-cased routing needed.
      const img = event['image'] as Record<string, unknown> | undefined;
      return {
        type: EventType.EVENT,
        threadID: (event['threadID'] as string) ?? '',
        logMessageType: LogMessageType.THREAD_IMAGE,
        logMessageData: {
          // image is null-safe; removed-photo events carry a null image payload from Facebook
          image: img
            ? {
                attachmentID: img['attachmentID'] ?? null,
                width: img['width'] ?? null,
                height: img['height'] ?? null,
                url: img['url'] ?? null,
              }
            : { attachmentID: null, width: null, height: null, url: null },
        },
        logMessageBody: (event['snippet'] as string) ?? '',
        timestamp: (event['timestamp'] as number | null) ?? null,
        author: (event['author'] as string) ?? '',
      };
    }

    case EventType.READ_RECEIPT:
      return {
        type: event['type'],
        reader: (event['reader'] as string) ?? '',
        time: (event['time'] as number | null) ?? null,
        threadID: (event['threadID'] as string) ?? '',
      };

    case EventType.READ:
      return {
        type: event['type'],
        threadID: (event['threadID'] as string) ?? '',
        time: (event['time'] as number | null) ?? null,
      };

    case EventType.READY:
      return {
        type: event['type'],
        error: event['error'] ?? null,
      };

    case EventType.STOP_LISTEN:
      return {
        type: event['type'],
        error: (event['error'] as string) ?? '',
      };

    case EventType.PARSE_ERROR:
      return {
        type: event['type'],
        error: (event['error'] as string) ?? '',
        detail: event['detail'] ?? null,
        res: event['res'] ?? null,
      };

    case EventType.BUTTON_ACTION:
      return {
        type: event['type'],
        platform: (event['platform'] as string) ?? '',
        threadID: (event['threadID'] as string) ?? '',
        senderID: (event['senderID'] as string) ?? '',
        messageID: (event['messageID'] as string) ?? '',
        actionId: (event['actionId'] as string) ?? '',
        timestamp: (event['timestamp'] as number | null) ?? null,
      };

    default:
      // Unknown platform event type — passthrough to avoid silent data loss;
      // the handler layer is responsible for deciding whether to ignore or log it
      return { ...event };
  }
}
