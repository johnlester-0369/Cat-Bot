/**
 * Facebook Messenger — Event Normalization
 *
 * Converts raw fca-unofficial message events into the unified event shape.
 * Separated from stream utilities because event normalization is a
 * domain-specific concern, not a general-purpose helper.
 */

import { Platforms } from '@/engine/modules/platform/platform.constants.js';

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
    timestamp: isReply
      ? Number(event.timestamp) || 0
      : (event.timestamp ?? null),
  };

  if (isReply) {
    return {
      ...base,
      // fca-unofficial provides the full PROTO_REPLIED_MESSAGE shape on messageReply — pass all fields through
      // so command/event modules can safely read senderID, attachments, timestamp, etc. on the replied message.
      messageReply: event.messageReply
        ? {
            threadID: event.messageReply.threadID ?? '',
            messageID: event.messageReply.messageID ?? '',
            senderID: event.messageReply.senderID ?? '',
            attachments: (event.messageReply.attachments ?? []).map((a) => ({
              type: a.type ?? 'unknown',
              url: a.url ?? null,
            })),
            args:
              event.messageReply.args ??
              (event.messageReply.body ?? '')
                .trim()
                .split(/\s+/)
                .filter(Boolean),
            message: event.messageReply.body ?? '',
            isGroup: !!event.messageReply.isGroup,
            mentions: event.messageReply.mentions ?? {},
            timestamp: event.messageReply.timestamp ?? 0,
          }
        : null,
    };
  }

  return base;
}

/**
 * Normalises an fca-unofficial E2EE message event into the unified message or
 * message_reply event shape. E2EE events carry a distinct type string ('e2ee_message')
 * and encryption metadata in the 'e2ee' field.
 *
 * Routing: e2ee.replyTo !== null → 'message_reply', null → 'message'.
 * isE2EE: true and the e2ee object are preserved so the E2EEApiProxy in
 * event-router.ts can route sends through sendMessageE2EE / sendMediaE2EE
 * and command modules can detect the encrypted context when needed.
 */
export function normalizeE2eeMessageEvent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const message = (event['body'] as string) ?? '';
  const e2ee = (event['e2ee'] as Record<string, unknown> | undefined) ?? {};
  const replyTo =
    (e2ee['replyTo'] as Record<string, unknown> | null | undefined) ?? null;
  const isReply = replyTo !== null;

  // E2EE attachments carry encryption fields (mediaKey, directPath, etc.) instead of a
  // plain URL — pass all fields through so command modules that handle E2EE media can read them.
  const attachments = ((event['attachments'] as unknown[]) ?? []).map((a) => {
    const att = a as Record<string, unknown>;
    return {
      type: (att['type'] as string) ?? 'unknown',
      mimeType: att['mimeType'],
      fileSize: att['fileSize'],
      width: att['width'],
      height: att['height'],
      mediaKey: att['mediaKey'],
      mediaSha256: att['mediaSha256'],
      mediaEncSha256: att['mediaEncSha256'],
      directPath: att['directPath'],
      url: att['url'] ?? null,
      isE2EE: true,
    };
  });

  const base = {
    type: isReply ? 'message_reply' : 'message',
    platform: Platforms.FacebookMessenger,
    threadID: (event['threadID'] as string) ?? '',
    senderID: (event['senderID'] as string) ?? '',
    message,
    messageID: (event['messageID'] as string) ?? '',
    args: message.trim().split(/\s+/).filter(Boolean),
    attachments,
    isGroup: !!(event['isGroup'] as boolean | undefined),
    mentions: (event['mentions'] as Record<string, string>) ?? {},
    // Mirror normalizeMessageEvent: replies use a numeric timestamp; plain messages allow string|number|null
    timestamp: isReply
      ? Number(event['timestamp']) || 0
      : ((event['timestamp'] as number | null) ?? null),
    // Forwarded so E2EEApiProxy knows to route sends to E2EE fca methods
    isE2EE: true,
    e2ee,
  };

  if (isReply) {
    // senderId in e2ee.replyTo arrives as BigInt from fca-unofficial — convert to string
    // for cross-platform consistency (all other senderID fields are plain strings).
    const senderId = replyTo['senderId'] as
      | bigint
      | number
      | string
      | undefined;
    return {
      ...base,
      messageReply: {
        threadID: (event['threadID'] as string) ?? '',
        messageID: (replyTo['messageId'] as string) ?? '',
        senderID: senderId !== undefined ? String(senderId) : '',
        attachments: [],
        args: message.trim().split(/\s+/).filter(Boolean),
        message,
        isGroup: !!(event['isGroup'] as boolean | undefined),
        mentions: {},
        timestamp: 0,
      },
    };
  }

  return base;
}
