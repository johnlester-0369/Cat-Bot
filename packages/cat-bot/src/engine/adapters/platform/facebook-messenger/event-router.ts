/**
 * Facebook Messenger — Event Router
 *
 * Pure routing logic that maps fca-unofficial raw event types to the
 * unified emitter event names. Separated from the listener lifecycle
 * so the routing table can be inspected and tested independently.
 *
 * Event mapping:
 *   'message'            → emit 'message'
 *   'message_reply'      → emit 'message_reply'
 *   'message_reaction'   → formatEvent + emit 'message_reaction'
 *   'message_unsend'     → formatEvent + emit 'message_unsend'
 *   'event'              → formatEvent + emit 'event'
 *   'change_thread_image' → formatEvent (folds to EVENT) + emit 'event'
 *   (other)              → emit verbatim on original type name
 */

import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { EventEmitter } from 'events';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { formatEvent } from '@/engine/adapters/models/event.model.js';
import { normalizeMessageEvent } from './utils/index.js';
import { E2EEApiProxy } from './lib/e2ee.js';

interface NativePayload {
  platform: string;
  api: unknown;
  event: Record<string, unknown>;
}

/**
 * Routes a single fca-unofficial raw event to the appropriate emitter event.
 * Called inside the MQTT listener callback — must be fast and never throw.
 */
export function routeRawEvent(
  rawEvent: Record<string, unknown>,
  apiWrapper: UnifiedApi,
  native: NativePayload,
  emitter: EventEmitter,
  prefix: string,
): void {
  const type = rawEvent['type'] as string;

  switch (type) {
    case 'message':
    case 'message_reply': {
      // Both types normalise to UnifiedMessageEvent via normalizeMessageEvent;
      // we emit on the ORIGINAL fca type so app.ts can subscribe to 'message_reply'
      // independently from 'message' if distinct handling is needed.
      const event = normalizeMessageEvent(rawEvent);
      emitter.emit(type, { api: apiWrapper, event, native, prefix });
      break;
    }

    case 'message_reaction':
    case 'message_unsend': {
      // formatEvent adds null-safety for any fields that may be absent on edge-case payloads
      // Spread platform tag: formatEvent strips it (fca events lack it), but all other platforms include it
      const event = {
        ...formatEvent(rawEvent),
        platform: Platforms.FacebookMessenger,
        // formatEvent only maps declared fields — participantIDs is stripped without this re-attachment.
        participantIDs: (rawEvent['participantIDs'] as string[] | undefined) ?? [],
      };
      emitter.emit(type, { api: apiWrapper, event, native, prefix });
      break;
    }

    case 'event':
    case 'change_thread_image': {
      // formatEvent normalises change_thread_image → EventType.EVENT + logMessageType
      // 'log:thread-image' so handlers subscribe once for that key regardless of platform.
      const event = {
        ...formatEvent(rawEvent),
        platform: Platforms.FacebookMessenger,
        // Same reason as message_reaction/unsend — preserve the raw participantIDs so join/leave
        // handlers can derive real-time member count from the event without an extra API call.
        participantIDs: (rawEvent['participantIDs'] as string[] | undefined) ?? [],
      };
      emitter.emit('event', { api: apiWrapper, event, native, prefix });
      break;
    }

    case 'e2ee_message': {
      // Handled natively by FBClient.onEvent -> routeFbClientEvent
      break;
    }

    case 'e2ee_message_reaction': {
      // Handled natively by FBClient.onEvent -> routeFbClientEvent
      break;
    }

    default:
      // Unknown fca event type (e.g. 'typ', 'presence', 'read_receipt') — emit verbatim
      // so app.ts can subscribe to any fca type without modifying this file.
      emitter.emit(type, { api: apiWrapper, event: rawEvent, native, prefix });
      break;
  }
}

/**
 * Routes native E2EE events coming directly from FBClient.
 * Converts the client event into the normalized Unified Event structure.
 */
export function routeFbClientEvent(
  eventWrapper: any,
  apiWrapper: UnifiedApi,
  native: any,
  emitter: EventEmitter,
  prefix: string,
): void {
  if (eventWrapper.type !== 'e2ee_message') return;

  const data = eventWrapper.data;
  if (!data) return;

  const threadID = data.threadId || '';
  const messageID = data.id || '';
  const senderID = data.senderId || '';
  const kind = data.kind || '';
  const timestamp = data.timestampMs || Date.now();

  const e2eeApi = new E2EEApiProxy(apiWrapper, native.fbClient, threadID);

  let emitType = 'event';
  const unifiedEvent: any = {
    platform: Platforms.FacebookMessenger,
    threadID,
    messageID,
    senderID,
    timestamp,
    isE2EE: true,
    isGroup: !!data.isGroup,
  };

  if (
    ['text', 'image', 'video', 'audio', 'document', 'sticker'].includes(kind)
  ) {
    unifiedEvent.message = data.text || '';
    unifiedEvent.args = unifiedEvent.message
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    unifiedEvent.attachments = [];
    if (data.media)
      unifiedEvent.attachments.push({ type: kind, url: null, isE2EE: true });

    if (data.replyTo) {
      emitType = 'message_reply';
      unifiedEvent.type = 'message_reply';
      unifiedEvent.messageReply = {
        messageID: data.replyTo.messageId,
        senderID: data.replyTo.senderId,
        message: '',
        args: [],
        attachments: [],
        timestamp: 0,
      };
    } else {
      emitType = 'message';
      unifiedEvent.type = 'message';
    }
  } else if (kind === 'reaction') {
    emitType = 'message_reaction';
    unifiedEvent.type = 'message_reaction';
    unifiedEvent.reaction = data.reaction || '';
    unifiedEvent.messageID = data.targetId || messageID;
    unifiedEvent.userID = senderID;
  } else if (kind === 'revoke') {
    emitType = 'message_unsend';
    unifiedEvent.type = 'message_unsend';
    unifiedEvent.messageID = data.targetId || messageID;
  } else {
    return;
  }

  emitter.emit(emitType, { api: e2eeApi, event: unifiedEvent, native, prefix });
}
