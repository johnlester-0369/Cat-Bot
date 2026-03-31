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

// PLATFORM_ID used only inside routeRawEvent() body — the circular import with index.ts
// (which statically imports this file) is safe because ESM live bindings resolve before any function call.
import { PLATFORM_ID } from './index.js';
import type { EventEmitter } from 'events';
import type { UnifiedApi } from '@/adapters/models/api.model.js';
import { formatEvent } from '@/adapters/models/event.model.js';
import { normalizeMessageEvent } from './utils/normalize-event.js';

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
        platform: PLATFORM_ID,
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
        platform: PLATFORM_ID,
      };
      emitter.emit('event', { api: apiWrapper, event, native, prefix });
      break;
    }

    default:
      // Unknown fca event type (e.g. 'typ', 'presence', 'read_receipt') — emit verbatim
      // so app.ts can subscribe to any fca type without modifying this file.
      emitter.emit(type, { api: apiWrapper, event: rawEvent, native, prefix });
      break;
  }
}
