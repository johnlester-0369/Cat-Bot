/**
 * onChat runner — passive middleware execution.
 *
 * Runs every command's onChat handler for each incoming message regardless of
 * prefix. Used for cross-cutting concerns like logging that process every message.
 */

import type { BaseCtx, CommandMap } from '../types/controller.types.js';
// Platform filter — respects config.platform[] declared by each command module
import { isPlatformAllowed } from '@/utils/platform-filter.util.js';

/**
 * Fans out to every command's onChat handler — used for passive middleware
 * like the logger module that processes every message regardless of prefix.
 */
export async function runOnChat(
  commands: CommandMap,
  ctx: BaseCtx,
): Promise<void> {
  for (const [name, mod] of commands) {
    if (typeof mod['onChat'] === 'function') {
      // Skip modules that explicitly exclude this platform via config.platform[]
      if (!isPlatformAllowed(mod, ctx.native.platform)) continue;
      await (mod['onChat'] as (ctx: BaseCtx) => Promise<void>)(ctx).catch(
        (err: unknown) => console.error(`❌ onChat "${name}" failed`, err),
      );
    }
  }
}
