/**
 * React Dispatch — matches message_reaction events to pending onReact states.
 *
 * Follows the same three-scope lookup pattern as reply dispatch:
 *   - Private (messageID:userID) — only the original reactor advances
 *   - Public  (messageID:threadID) — any group member's reaction advances a shared flow
 *   - Legacy  (messageID)          — backward compatibility
 *
 * Each emoji maps to a separate handler in the command's onReact object,
 * allowing per-reaction-type flows from a single pending state.
 */

import type { BaseCtx, CommandMap } from '@/engine/types/controller.types.js';
import { resolveStateEntry } from '../utils/state-lookup.util.js';
import { createStateContext } from '@/engine/adapters/models/context.model.js';
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/engine/lib/middleware.lib.js';
import type { OnReactCtx } from '@/engine/types/middleware.types.js';
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';

/**
 * Checks for a pending onReact state matching the message_reaction event's
 * messageID, then dispatches to the emoji-keyed handler in onReact.
 * Called in handleEvent before generic event dispatch — reaction flows take priority.
 */
export async function dispatchOnReact(
  commands: CommandMap,
  event: Record<string, unknown>,
  ctx: BaseCtx,
): Promise<boolean> {
  const messageID = event['messageID'] as string | undefined;
  const emoji = event['reaction'] as string | undefined;
  // Both fields required — a reaction event missing either cannot match a registered state.
  if (!messageID || !emoji) return false;

  // Three-scope lookup (private → public → legacy) is centralised in resolveStateEntry —
  // adding a new scope or changing priority only requires one edit in the utility.
  const resolution = resolveStateEntry(
    messageID,
    event['userID'] as string, // private: only the original reactor advances
    event['threadID'] as string, // public:  any group member's reaction advances a shared flow
  );
  if (!resolution) return false;
  const { stored, lookupKey } = resolution;

  const mod = commands.get(stored.command);
  if (!mod || typeof mod['onReact'] !== 'object' || !mod['onReact'])
    return false;
  // Respect config.platform[] — skip react dispatch on platforms the module doesn't support
  if (!isPlatformAllowed(mod, ctx.native.platform)) return false;

  const onReact = mod['onReact'] as Record<
    string,
    (ctx: unknown) => Promise<void>
  >;
  // When stored.state is an array it acts as an emoji allowlist declared at state.create() time.
  // Only emojis in that list are valid for this pending state — any other reaction is ignored,
  // preventing unrelated reactions on the same message from advancing the flow unexpectedly.
  if (Array.isArray(stored.state) && !stored.state.includes(emoji)) return false;
  // Scalar state is a step label (onReply pattern reused) — no allowlist check needed.
  // In both cases, dispatch on the live emoji from the event, not on stored.state.
  const handler = onReact[emoji];
  if (typeof handler !== 'function') return false;
  const session = { id: lookupKey, ...stored };
  const { state } = createStateContext(stored.command, event);
  // Attach emoji and messageID to reactCtx so onReact middleware can apply per-emoji guards
  // (e.g. allowlist enforcement, cooldown checks by emoji type).
  const reactCtx: OnReactCtx = { ...ctx, session, emoji, messageID };

  // Run onReact middleware chain before the handler.
  await runMiddlewareChain<OnReactCtx>(
    middlewareRegistry.getOnReact(),
    reactCtx,
    async () => {
      await handler({ ...reactCtx, state }).catch((err: unknown) => {
        console.error(`❌ onReact "${stored.command}.${emoji}" failed`, err);
      });
    },
  );

  return true;
}
