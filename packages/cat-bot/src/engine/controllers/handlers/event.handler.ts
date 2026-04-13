/**
 * Event Handler — entry point for thread-level and reaction events.
 *
 * Dispatches on event.logMessageType so event modules subscribe to specific
 * subtypes (e.g. 'log:subscribe', 'log:unsubscribe', 'log:thread-name').
 * OnReact state-driven flows are checked first for message_reaction events,
 * falling through to generic event dispatch only when no state matches.
 */

import type {
  CommandMap,
  EventModuleMap,
  NativeContext,
} from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { dispatchEvent } from '../dispatchers/event.dispatcher.js';
import { dispatchOnReact } from '../dispatchers/react.dispatcher.js';
// BaseCtx construction delegated to shared factory — eliminates ~35-line duplication across handlers
import { buildBaseCtx } from '../factories/ctx.factory.js';

/**
 * Entry point for platform thread-level events (member join, leave, rename, etc.)
 * and for message_reaction events that trigger onReact state-driven flows.
 *
 * Dispatches on event.logMessageType so event modules can subscribe to specific
 * event subtypes (e.g. 'log:subscribe', 'log:unsubscribe', 'log:thread-name').
 * All platforms normalise their native member events into EventType.EVENT shape
 * before calling this function — eliminates the need for separate handleJoin/handleLeave.
 */
export async function handleEvent(
  api: UnifiedApi,
  event: Record<string, unknown>,
  eventModules: EventModuleMap,
  native: NativeContext = { platform: 'unknown' },
  commands: CommandMap = new Map(),
): Promise<void> {
  const baseCtx = buildBaseCtx(api, event, commands, native);
  // Check for a pending onReact state before routing to generic event handlers.
  if (event['type'] === 'message_reaction' && commands.size > 0) {
    const handled = await dispatchOnReact(commands, event, baseCtx);
    if (handled) return;
  }

  // Dispatch on logMessageType so modules register for specific event subtypes.
  // Fallback to event.type ('event') when logMessageType is absent.
  const dispatchKey = (event['logMessageType'] ?? event['type']) as string;
  await dispatchEvent(eventModules, dispatchKey, baseCtx);
}
