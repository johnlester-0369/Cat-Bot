/**
 * Reply Dispatch — matches quote-reply events to pending onReply states.
 *
 * Supports three key scopes for state lookup:
 *   - Private (messageID:senderID) — only the original sender can advance
 *   - Public  (messageID:threadID) — any group member can respond (polls, shared flows)
 *   - Legacy  (messageID)          — backward compatibility with older state entries
 *
 * Delegates to button.dispatcher for text-menu fallback flows on platforms
 * without native button support.
 */

import type { BaseCtx, CommandMap } from '@/types/controller.types.js';
import { stateStore } from '@/lib/reply-state.lib.js';
import { createStateContext } from '@/adapters/models/context.model.js';
import { dispatchButtonFallback } from './button.dispatcher.js';
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/lib/middleware.lib.js';
import type { OnReplyCtx } from '@/types/middleware.types.js';
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/utils/platform-filter.util.js';

/**
 * Checks whether a message_reply event matches a pending onReply state and, if so,
 * dispatches the registered handler. Called in handleMessage BEFORE prefix parsing
 * so ongoing conversation flows take priority over new command dispatch.
 */
export async function dispatchOnReply(
  commands: CommandMap,
  event: Record<string, unknown>,
  ctx: BaseCtx,
): Promise<boolean> {
  // event.messageReply.messageID is the bot's sent message that the user quoted
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  const repliedToID = messageReply?.['messageID'] as string | undefined;
  if (!repliedToID) return false;

  // Try scoped composite keys before falling back to the bare message ID.
  // Private key (messageID:senderID) ensures only the original sender can advance the flow.
  // Public key (messageID:threadID) allows any group member to respond (polls, shared flows).
  const privateKey = `${repliedToID}:${event['senderID'] as string}`;
  const publicKey = `${repliedToID}:${event['threadID'] as string}`;
  const privateStored = stateStore.get(privateKey);
  const publicStored = stateStore.get(publicKey);
  const legacyStored = stateStore.get(repliedToID);
  const stored = privateStored ?? publicStored ?? legacyStored;
  const lookupKey = privateStored
    ? privateKey
    : publicStored
      ? publicKey
      : repliedToID;
  if (!stored) return false;

  // Button fallback path: routes numbered text replies to menu[actionId].run() for platforms
  // without native button support (Facebook Messenger). State is never deleted here.
  if (stored.context['type'] === 'button_fallback') {
    return dispatchButtonFallback(commands, event, ctx, stored, lookupKey);
  }

  const mod = commands.get(stored.command);
  if (!mod || typeof mod['onReply'] !== 'object' || !mod['onReply'])
    return false;
  // Respect config.platform[] — skip reply dispatch on platforms the module doesn't support
  if (!isPlatformAllowed(mod, ctx.native.platform)) return false;

  const onReply = mod['onReply'] as Record<
    string,
    (ctx: unknown) => Promise<void>
  >;
  const handler = onReply[stored.state];
  if (typeof handler !== 'function') return false;

  // Expose session.id so handlers can call removeState() without reconstructing the key,
  // and session.context carries shared data across multiple onReply steps.
  const session = { id: lookupKey, ...stored };
  const { state } = createStateContext(stored.command, event);
  // Attach session to replyCtx before running middleware — onReply middleware can inspect
  // session.context for conversation-state-aware guards (e.g. step timeout checks).
  const replyCtx: OnReplyCtx = { ...ctx, session };

  // Run onReply middleware chain before the handler — guards (timeout, permission checks)
  // are injected here without touching dispatcher routing logic.
  await runMiddlewareChain<OnReplyCtx>(
    middlewareRegistry.getOnReply(),
    replyCtx,
    async () => {
      await handler({ ...replyCtx, state }).catch((err: unknown) => {
        console.error(
          `❌ onReply "${stored.command}.${stored.state}" failed`,
          err,
        );
      });
    },
  );

  return true;
}
