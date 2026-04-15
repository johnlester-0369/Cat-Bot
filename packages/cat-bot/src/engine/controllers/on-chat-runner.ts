/**
 * onChat runner — passive middleware execution.
 *
 * Runs every command's onChat handler for each incoming message regardless of
 * prefix. Used for cross-cutting concerns like logging that process every message.
 */

import type { BaseCtx, CommandMap } from '@/engine/types/controller.types.js';
// Platform filter — respects config.platform[] declared by each command module
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';

/**
 * Fans out to every command's onChat handler — used for passive middleware
 * like the logger module that processes every message regardless of prefix.
 */
export async function runOnChat(
  commands: CommandMap,
  ctx: BaseCtx,
): Promise<void> {
  // Deduplicate by module reference before fan-out — loadCommands() registers one Map key
  // per command name AND one per alias, all pointing to the same module object. Without
  // this guard, a module with N aliases fires onChat N+1 times per message (e.g. ai.ts
  // with aliases ['chatgpt', 'bot'] would call onChat 3× and send 3 AI replies).
  const seen = new Set<Record<string, unknown>>();
  for (const [name, mod] of commands) {
    if (seen.has(mod)) continue;
    seen.add(mod);
    if (typeof mod['onChat'] === 'function') {
      // Skip modules that explicitly exclude this platform via config.platform[]
      if (!isPlatformAllowed(mod, ctx.native.platform)) continue;
      await (mod['onChat'] as (ctx: BaseCtx) => Promise<void>)(ctx).catch(
        (err: unknown) => console.error(`❌ onChat "${name}" failed`, err),
      );
    }
  }
}
