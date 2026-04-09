/**
 * Facebook Messenger — Event Normalization
 *
 * Converts raw fca-unofficial message events into the unified event shape.
 * Separated from stream utilities because event normalization is a
 * domain-specific concern, not a general-purpose helper.
 */

import { Platforms } from '@/engine/constants/platform.constants.js';

/**
 * Raw fca-unofficial attachment shape — only fields consumed by normalizeMessageEvent.
 * fca-unofficial has no published types so we declare the minimal contract here.
 */
interface FcaAttachment {
  type?: string;
  url?: string;
}

/**
 * Raw fca-unofficial message event shape — only fields consumed by normalizeMessageEvent.
 */
interface FcaMessageEvent {
  type?: string;
  threadID?: string;
  senderID?: string;
  body?: string;
  messageID?: string;
  attachments?: FcaAttachment[];
  isGroup?: boolean;
  mentions?: Record<string, string>;
  timestamp?: string | number | null;
  messageReply?: {
    threadID?: string;
    messageID?: string;
    senderID?: string;
    attachments?: FcaAttachment[];
    args?: string[];
    body?: string;
    isGroup?: boolean;
    mentions?: Record<string, string>;
    timestamp?: number | null;
  };
}

/**
 * Normalises an fca-unofficial message event into the unified message event shape.
 * Called for both 'message' and 'message_reply' fca event types before emit.
 */
export function normalizeMessageEvent(
  event: FcaMessageEvent,
): Record<string, unknown> {
  const message = event.body ?? '';
  const isReply = event.type === 'message_reply';

  const base = {
    // Pass through fca's type ('message' or 'message_reply') so the emitter event name and event.type agree
    type: event.type ?? 'message',
    platform: Platforms.FacebookMessenger,
    // Enforce string fallbacks so unified models never receive undefined
    threadID: event.threadID ?? '',
    senderID: event.senderID ?? '',
    message,
    messageID: event.messageID ?? '',
    args: message.trim().split(/\s+/).filter(Boolean),
    attachments: (event.attachments ?? []).map((a) => ({
      type: a.type ?? 'unknown',
      url: a.url ?? null,
    })),
    isGroup: !!event.isGroup,
    mentions: event.mentions ?? {},
    // PROTO_REPLIED_MESSAGE requires number; PROTO_EVENT_MESSAGE allows string|number|null
    timestamp: isReply ? (Number(event.timestamp) || 0) : (event.timestamp ?? null),
  };

  if (isReply) {
    return {
      ...base,
      // fca-unofficial provides the full PROTO_REPLIED_MESSAGE shape on messageReply — pass all fields through
      // so command/event modules can safely read senderID, attachments, timestamp, etc. on the replied message.
      messageReply: event.messageReply ? {
        threadID: event.messageReply.threadID ?? '',
        messageID: event.messageReply.messageID ?? '',
        senderID: event.messageReply.senderID ?? '',
        attachments: (event.messageReply.attachments ?? []).map((a) => ({
          type: a.type ?? 'unknown',
          url: a.url ?? null,
        })),
        args: event.messageReply.args ?? (event.messageReply.body ?? '').trim().split(/\s+/).filter(Boolean),
        message: event.messageReply.body ?? '',
        isGroup: !!event.messageReply.isGroup,
        mentions: event.messageReply.mentions ?? {},
        timestamp: event.messageReply.timestamp ?? 0,
      } : null,
    };
  }

  return base;
}
