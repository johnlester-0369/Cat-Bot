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
import { normalizeMessageEvent, normalizeE2eeMessageEvent } from './utils/index.js';
import { E2EEApiProxy } from './lib/e2ee.js';
import type { FcaApi } from './types.js';

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
      };
      emitter.emit('event', { api: apiWrapper, event, native, prefix });
      break;
    }

    case 'e2ee_message': {
      // E2EE private chats use chatJid format ("{threadID}@msgr") for all send APIs —
      // extract from e2ee metadata (always present) or derive from the raw threadID.
      const e2eePayload = rawEvent['e2ee'] as { chatJid?: string } | undefined;
      const chatJid =
        e2eePayload?.chatJid ??
        `${rawEvent['threadID'] as string}@msgr`;
      const normalizedEvent = normalizeE2eeMessageEvent(rawEvent);
      // 'message' or 'message_reply' — determined by e2ee.replyTo !== null inside normalizer
      const emitType = normalizedEvent['type'] as string;
      // Wrap the session-level UnifiedApi with E2EE send overrides scoped to this chatJid.
      // E2EEApiProxy is per-event and not held beyond this call — no shared mutable state.
      const e2eeApi = new E2EEApiProxy(apiWrapper, native.api as FcaApi, chatJid);
      emitter.emit(emitType, { api: e2eeApi, event: normalizedEvent, native, prefix });
      break;
    }

    case 'e2ee_message_reaction': {
      // threadID in E2EE reaction events arrives as chatJid format ("123456@msgr") —
      // strip the @msgr suffix so it matches the plain threadID convention used by
      // all other event types and by the DB layer.
      const rawThreadID = (rawEvent['threadID'] as string) ?? '';
      const threadID = rawThreadID.endsWith('@msgr')
        ? rawThreadID.slice(0, -5)
        : rawThreadID;
      const event = {
        type: 'message_reaction',
        platform: Platforms.FacebookMessenger,
        threadID,
        messageID: (rawEvent['messageID'] as string) ?? '',
        reaction: (rawEvent['reaction'] as string) ?? '',
        senderID: (rawEvent['senderID'] as string) ?? '',
        userID: (rawEvent['userID'] as string) ?? '',
        timestamp: null,
        offlineThreadingID: '',
        isE2EE: true,
      };
      emitter.emit('message_reaction', { api: apiWrapper, event, native, prefix });
      break;
    }

    default:
      // Unknown fca event type (e.g. 'typ', 'presence', 'read_receipt') — emit verbatim
      // so app.ts can subscribe to any fca type without modifying this file.
      emitter.emit(type, { api: apiWrapper, event: rawEvent, native, prefix });
      break;
  }
}
