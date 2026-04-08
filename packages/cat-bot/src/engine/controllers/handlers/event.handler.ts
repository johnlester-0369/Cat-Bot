/**
 * Event Handler — entry point for thread-level and reaction events.
 *
 * Dispatches on event.logMessageType so event modules subscribe to specific
 * subtypes (e.g. 'log:subscribe', 'log:unsubscribe', 'log:thread-name').
 * OnReact state-driven flows are checked first for message_reaction events,
 * falling through to generic event dispatch only when no state matches.
 */

import type {
  BaseCtx,
  CommandMap,
  EventModuleMap,
  NativeContext,
} from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/engine/adapters/models/context.model.js';
import { createLogger } from '@/engine/lib/logger.lib.js';
import { dispatchEvent } from '../dispatchers/event.dispatcher.js';
import { dispatchOnReact } from '../dispatchers/react.dispatcher.js';
import { PLATFORM_TO_ID } from '@/engine/constants/platform.constants.js';
import { getUserName } from '@/engine/repos/users.repo.js';
import { getThreadName } from '@/engine/repos/threads.repo.js';

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
  // Inject session-scoped logger for context-aware event logging
  const logger = createLogger({
    userId: native.userId ?? '',
    platformId: (PLATFORM_TO_ID as Record<string, number>)[native.platform] ?? native.platform,
    sessionId: native.sessionId ?? '',
  });

  // Build unified context object for all events so both onReact and generic onEvent
  // handlers have access to the same chat/thread operations as message handlers.
  const thread = createThreadContext(api, event);
  const chat = createChatContext(api, event);
  const bot = createBotContext(api);
  const user = createUserContext(api);
  const baseCtx: BaseCtx = {
    api,
    event,
    commands,
    thread,
    chat,
    bot,
    user,
    native,
    logger,
    db: {
      users: { getName: getUserName },
      threads: { getName: getThreadName },
    },
  };

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
