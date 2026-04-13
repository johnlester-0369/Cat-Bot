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

import type { BaseCtx, CommandMap } from '@/engine/types/controller.types.js';
import { resolveStateEntry } from '../utils/state-lookup.util.js';
import {
  createStateContext,
  createButtonContext,
} from '@/engine/adapters/models/context.model.js';
import { dispatchButtonFallback } from './button.dispatcher.js';
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/engine/lib/middleware.lib.js';
import type { OnReplyCtx } from '@/engine/types/middleware.types.js';
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';

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

  // Three-scope lookup (private → public → legacy) is centralised in resolveStateEntry —
  // adding a new scope or changing priority only requires one edit in the utility.
  const resolution = resolveStateEntry(
    repliedToID,
    event['senderID'] as string, // private: only the triggering sender can advance
    event['threadID'] as string, // public:  any group member can respond (polls, shared flows)
  );
  if (!resolution) return false;
  const { stored, lookupKey } = resolution;

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
  const session = { id: lookupKey, ...stored };
  const { state } = createStateContext(stored.command, event);
  const { button } = createButtonContext(stored.command, event);
  // Attach session to replyCtx before running middleware — onReply middleware can inspect
  // session.context for conversation-state-aware guards (e.g. step timeout checks).
  const replyCtx: OnReplyCtx = { ...ctx, session };

  // Run onReply middleware chain before the handler — guards (timeout, permission checks)
  // are injected here without touching dispatcher routing logic.
  await runMiddlewareChain<OnReplyCtx>(
    middlewareRegistry.getOnReply(),
    replyCtx,
    async () => {
      await handler({
        ...replyCtx,
        state,
        button,
        args: [],
        options: import('@/engine/modules/options/options-map.lib.js').then(m => m.OptionsMap.empty()) as any,
        parsed: { name: stored.command, args: [] },
        emoji: '',
        messageID: (event['messageID'] as string) || '',
      }).catch((err: unknown) => {
        console.error(
          `❌ onReply "${stored.command}.${stored.state}" failed`,
          err,
        );
      });
    },
  );

  return true;
}
