/**
 * Event Dispatcher — fans out to registered event handlers for a given type.
 *
 * Simple, reusable pattern: any module that registers for an event type via
 * config.eventType[] gets its onEvent handler called in registration order.
 */

import type { EventModuleMap } from '@/types/controller.types.js';
// Platform filter — enforces config.platform[] declared by each event module
import { isPlatformAllowed } from '@/utils/platform-filter.util.js';

/**
 * Fires every registered handler for the given unified event type.
 */
export async function dispatchEvent(
  eventModules: EventModuleMap,
  eventType: string,
  ctx: Record<string, unknown>,
): Promise<void> {
  // Extract platform once — avoids a repeated cast inside the handler loop
  const platform =
    ((ctx['native'] as Record<string, unknown> | undefined)?.[
      'platform'
    ] as string) ?? 'unknown';
  const handlers = eventModules.get(eventType) ?? [];
  for (const mod of handlers) {
    if (typeof mod['onEvent'] === 'function') {
      // Skip modules that explicitly exclude this platform via config.platform[]
      if (!isPlatformAllowed(mod, platform)) continue;
      try {
        // Await handles both sync and async returns safely; catch blocks capture any rejections without assuming a .catch() method exists on the return value
        await (mod['onEvent'] as (ctx: unknown) => unknown)(ctx);
      } catch (err: unknown) {
        console.error(`❌ Event handler "${eventType}" failed`, err);
      }
    }
  }
}
