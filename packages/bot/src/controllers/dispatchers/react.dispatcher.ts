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

import type { BaseCtx, CommandMap } from '@/types/controller.types.js';
import { stateStore } from '@/lib/reply-state.lib.js';
import { createStateContext } from '@/adapters/models/context.model.js';
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/lib/middleware.lib.js';
import type { OnReactCtx } from '@/types/middleware.types.js';
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/utils/platform-filter.util.js';

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

  // Private key (messageID:senderID) — only the original reactor advances the flow.
  // Public key (messageID:threadID) — any group member's reaction advances a shared flow.
  const privateKey = `${messageID}:${event['userID'] as string}`;
  const publicKey = `${messageID}:${event['threadID'] as string}`;
  const privateStored = stateStore.get(privateKey);
  const publicStored = stateStore.get(publicKey);
  const legacyStored = stateStore.get(messageID);
  const stored = privateStored ?? publicStored ?? legacyStored;
  const lookupKey = privateStored
    ? privateKey
    : publicStored
      ? publicKey
      : messageID;
  if (!stored) return false;

  const mod = commands.get(stored.command);
  if (!mod || typeof mod['onReact'] !== 'object' || !mod['onReact'])
    return false;
  // Respect config.platform[] — skip react dispatch on platforms the module doesn't support
  if (!isPlatformAllowed(mod, ctx.native.platform)) return false;

  const onReact = mod['onReact'] as Record<
    string,
    (ctx: unknown) => Promise<void>
  >;
  // Dispatch on the actual emoji from the event — each reaction type maps to a separate handler.
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
