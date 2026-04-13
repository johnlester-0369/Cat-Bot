/**
 * Button Dispatch — routes interactive button clicks and text-menu fallbacks
 * to the owning command's button[buttonId].onClick() handler.
 *
 * Two paths converge here:
 *   1. Native button clicks (Discord, Telegram, FB Page) → handleButtonAction()
 *   2. Text-menu number replies (FB Messenger fallback) → dispatchButtonFallback()
 *
 * Both synthesise a uniform button_action event so onClick() handlers never need
 * to branch on platform.
 */

import type {
  BaseCtx,
  CommandMap,
  NativeContext,
} from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import {
  createChatContext,
  createStateContext,
  createButtonContext,
} from '@/engine/adapters/models/context.model.js';
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
// BaseCtx construction delegated to shared factory — eliminates ~35-line duplication across handlers
import { buildBaseCtx } from '../factories/ctx.factory.js';
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/engine/lib/middleware.lib.js';
import type { OnButtonClickCtx } from '@/engine/types/middleware.types.js';
import { buttonContextLib } from '@/engine/lib/button-context.lib.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

/**
 * Button Dispatch — routes interactive button clicks and text-menu fallbacks
 * Called from dispatchOnReply when stored.context.type === 'button_fallback' — this state is
 * registered by createChatContext automatically when chat.reply()/replyMessage() sends buttons
 * on Facebook Messenger, which lacks native interactive button components.
 *
 * State is intentionally NOT removed after dispatch so the numbered menu remains
 * re-selectable for the message's lifetime — mirroring how native button components
 * on Discord, Telegram, and Facebook Page persist until the message is deleted or edited.
 */
export async function dispatchButtonFallback(
  commands: CommandMap,
  event: Record<string, unknown>,
  ctx: BaseCtx,
  stored: {
    command: string;
    state: string;
    context: Record<string, unknown>;
  },
  _lookupKey: string,
): Promise<boolean> {
  const mod = commands.get(stored.command);
  if (!mod || typeof mod['button'] !== 'object' || !mod['button']) return false;
  // Respect config.platform[] — skip button fallback on platforms the module doesn't support
  if (!isPlatformAllowed(mod, ctx.native.platform)) return false;

  const buttonDef = mod['button'] as Record<
    string,
    {
      label: string;
      id: string;
      onClick?: (...args: unknown[]) => Promise<void>;
    }
  >;
  const userInput = ((event['message'] ?? '') as string).trim();
  const buttons =
    (stored.context['buttons'] as Array<{
      number: number;
      id: string;
      label: string;
    }>) ?? [];

  // Match by 1-based number first — the most natural input for a numbered text menu
  let matched: { id: string; label: string } | null = null;
  const num = parseInt(userInput, 10);
  if (!isNaN(num) && num >= 1 && num <= buttons.length) {
    matched = buttons[num - 1] ?? null;
  } else {
    // Case-insensitive label or ID substring match so both "ping" and "🏓 Ping" resolve correctly
    const lower = userInput.toLowerCase();
    matched =
      buttons.find(
        (b) =>
          b.label.toLowerCase().includes(lower) || b.id.toLowerCase() === lower,
      ) ?? null;
  }

  if (!matched) {
    // Consume the event with an error reply — prevents the prefix handler from treating a bare
    // number like "1" as a command and firing the "unknown command" response unnecessarily.
    await ctx.chat.replyMessage({
      message: `❓ Invalid selection. Reply with a number (1–${buttons.length}) to choose.`,
    });
    return true;
  }

  // Strip ~userId scope suffix before looking up the handler — FB Messenger button fallback
  // stores the full scoped ID for routing, but menu keys are the base button IDs without scope.
  const tildeIdx = matched.id.indexOf('~');
  const withoutScope =
    tildeIdx === -1 ? matched.id : matched.id.slice(0, tildeIdx);
  const hashIdx = withoutScope.indexOf('#');
  const baseFallbackId =
    hashIdx === -1 ? withoutScope : withoutScope.slice(0, hashIdx);

  const handler = buttonDef[baseFallbackId];
  if (!handler || typeof handler.onClick !== 'function') return false;

  // Synthesise a button_action event so onClick() receives the same shape as a native button
  // click on Discord, Telegram, or Facebook Page — no platform branching inside onClick() needed.
  const buttonEvent: Record<string, unknown> = {
    ...event,
    type: 'button_action',
    buttonId: `${stored.command}:${matched.id}`,
  };

  const { state } = createStateContext(stored.command, buttonEvent);
  const { button: btnCtx } = createButtonContext(stored.command, buttonEvent);
  const fullLocalId = matched.id;
  const storedContext =
    buttonContextLib.get(`${stored.command}:${fullLocalId}`) ?? {};

  // Re-bind ctx to the synthetic buttonEvent so chat.reply() targets the selection reply's
  // messageID rather than the original command trigger — ctx.prefix is forwarded unchanged.
  const buttonCtx: AppCtx = {
    ...buildBaseCtx(ctx.api, buttonEvent, ctx.commands, ctx.native, ctx.prefix),
    // Command-aware chat embeds "stored.command:buttonId" so handleButtonAction can reverse-route
    chat: createChatContext(
      ctx.api,
      buttonEvent,
      stored.command,
      buttonDef as Parameters<typeof createChatContext>[3],
    ),
    state,
    button: btnCtx,
    session: { id: fullLocalId, context: storedContext },
    args: [],
    options: OptionsMap.empty(),
    parsed: { name: stored.command, args: [] },
    emoji: '',
    messageID: (buttonEvent['messageID'] as string) || '',
  };

  // State is intentionally NOT deleted — the numbered menu remains persistently re-selectable,
  // equivalent to how button components on Discord, Telegram, and FB Page stay clickable.
  await handler.onClick(buttonCtx).catch((err: unknown) => {
    console.error(
      `❌ Button fallback "${stored.command}:${matched!.id}" failed`,
      err,
    );
  });

  return true;
}

/**
 * Entry point for interactive button actions (Discord button click, Telegram callback_query,
 * Facebook Page postback). Routes to the owning command's button[buttonId].onClick() handler.
 *
 * Routing contract: the platform embeds callback data as "commandName:buttonId"
 * (built by createChatContext.resolveButtons). This function splits on ':' to find
 * the command, then looks up the local button ID in that command's button export.
 */
export async function handleButtonAction(
  api: UnifiedApi,
  event: Record<string, unknown>,
  commands: CommandMap,
  native: NativeContext = { platform: 'unknown' },
): Promise<void> {
  const buttonIdStr = String(event['buttonId'] ?? '');
  const colonIdx = buttonIdStr.indexOf(':');
  if (colonIdx === -1) return; // Malformed — all valid IDs carry the "commandName:" prefix

  const commandName = buttonIdStr.slice(0, colonIdx);
  const fullLocalId = buttonIdStr.slice(colonIdx + 1);

  const storedContext =
    buttonContextLib.get(`${commandName}:${fullLocalId}`) ?? {};
  const { state } = createStateContext(commandName, event);
  const { button: btnCtx } = createButtonContext(commandName, event);

  // Build the button-click context and run the onButtonClick middleware chain.
  // enforceButtonScope (registered in middleware/index.ts) handles tilde-scope parsing,
  // ack() extraction, and per-user ownership enforcement, then populates ctx.baseButtonId,
  // ctx.scopeUserId, and ctx.ack before the final handler executes.
  const buttonClickCtx: OnButtonClickCtx = {
    ...buildBaseCtx(api, event, commands, native),
    commandName,
    // Placeholder values — enforceButtonScope overwrites these before calling next().
    // Same pattern as OnCommandCtx.options seeded as OptionsMap.empty() before validateCommandOptions.
    baseButtonId: '',
    scopeUserId: null,
    ack: undefined,
    session: { id: fullLocalId, context: storedContext },
  };

  await runMiddlewareChain<OnButtonClickCtx>(
    middlewareRegistry.getOnButtonClick(),
    buttonClickCtx,
    async () => {
      // enforceButtonScope has run — baseButtonId, scopeUserId, and ack are fully populated
      const { baseButtonId, ack } = buttonClickCtx;

      const mod = commands.get(commandName);
      if (!mod || typeof mod['button'] !== 'object' || !mod['button']) {
        // Acknowledge on Telegram even for early exits — prevents the spinner from hanging ~10 s.
        await ack?.().catch(() => {});
        return;
      }
      // Respect config.platform[] — skip button action on platforms the module doesn't support
      if (!isPlatformAllowed(mod, native.platform)) {
        await ack?.().catch(() => {});
        return;
      }

      const buttonDef = mod['button'] as Record<
        string,
        { onClick?: (...args: unknown[]) => Promise<void> }
      >;
      const handler = buttonDef[baseButtonId];
      if (!handler || typeof handler.onClick !== 'function') {
        await ack?.().catch(() => {});
        return;
      }

      // Dismiss the Telegram loading spinner before running the handler — handler.onClick() may take
      // several seconds (DB queries, API calls) and Telegram shows an error after ~10 s if the
      // callback query is not answered. On Discord, deferUpdate() already cleared the spinner.
      await ack?.().catch(() => {});
      // Reuse the middleware ctx base but override chat with the command-aware variant so button
      // callbacks embed "commandName:buttonId" for routing without a global button ID registry.
      const ctx: AppCtx = {
        ...buttonClickCtx,
        chat: createChatContext(
          api,
          event,
          commandName,
          mod['button'] as Parameters<typeof createChatContext>[3],
        ),
        state,
        button: btnCtx,
        args: [],
        options: OptionsMap.empty(),
        parsed: { name: commandName, args: [] },
        emoji: '',
        messageID: (event['messageID'] as string) || '',
      };

      await handler.onClick(ctx).catch((err: unknown) => {
        console.error(`❌ Button action "${buttonIdStr}" failed`, err);
      });
    },
  );
}
