/**
 * Button Dispatch — routes interactive button clicks and text-menu fallbacks
 * to the owning command's menu[actionId].run() handler.
 *
 * Two paths converge here:
 *   1. Native button clicks (Discord, Telegram, FB Page) → handleButtonAction()
 *   2. Text-menu number replies (FB Messenger fallback) → dispatchButtonFallback()
 *
 * Both synthesise a uniform button_action event so run() handlers never need
 * to branch on platform.
 */

import type {
  BaseCtx,
  CommandMap,
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
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/engine/utils/platform-filter.util.js';
import { PLATFORM_TO_ID } from '@/engine/constants/platform.constants.js';
import { getUserName } from '@/engine/repos/users.repo.js';
import { getThreadName } from '@/engine/repos/threads.repo.js';
import { createCollectionManager, createThreadCollectionManager } from '@/engine/lib/db-collection.lib.js';

/**
 * Routes a text-based button selection to the owning command's menu[actionId].run() handler.
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
  if (!mod || typeof mod['menu'] !== 'object' || !mod['menu']) return false;
  // Respect config.platform[] — skip button fallback on platforms the module doesn't support
  if (!isPlatformAllowed(mod, ctx.native.platform)) return false;

  const menu = mod['menu'] as Record<
    string,
    { label: string; id: string; run?: (...args: unknown[]) => Promise<void> }
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

  const handler = menu[matched.id];
  if (!handler || typeof handler.run !== 'function') return false;

  // Synthesise a button_action event so run() receives the same shape as a native button
  // click on Discord, Telegram, or Facebook Page — no platform branching inside run() needed.
  const buttonEvent: Record<string, unknown> = {
    ...event,
    type: 'button_action',
    actionId: `${stored.command}:${matched.id}`,
  };

  // Rebuild thread/chat/bot/user contexts bound to buttonEvent so chat.reply() inside run()
  // targets the correct messageID (the user's selection reply, not the initial command trigger).
  const thread = createThreadContext(ctx.api, buttonEvent);
  const chat = createChatContext(
    ctx.api,
    buttonEvent,
    stored.command,
    menu as Parameters<typeof createChatContext>[3],
  );
  const bot = createBotContext(ctx.api);
  const user = createUserContext(ctx.api);
  const buttonCtx = { ...ctx, event: buttonEvent, thread, chat, bot, user };

  // State is intentionally NOT deleted — the numbered menu remains persistently re-selectable,
  // equivalent to how button components on Discord, Telegram, and FB Page stay clickable.
  await handler.run(buttonCtx).catch((err: unknown) => {
    console.error(
      `❌ Button fallback "${stored.command}:${matched!.id}" failed`,
      err,
    );
  });

  return true;
}

/**
 * Entry point for interactive button actions (Discord button click, Telegram callback_query,
 * Facebook Page postback). Routes to the owning command's menu[actionId].run() handler.
 *
 * Routing contract: the platform embeds callback data as "commandName:actionId"
 * (built by createChatContext.resolveButtons). This function splits on ':' to find
 * the command, then looks up the local action ID in that command's menu export.
 */
export async function handleButtonAction(
  api: UnifiedApi,
  event: Record<string, unknown>,
  commands: CommandMap,
  native: NativeContext = { platform: 'unknown' },
): Promise<void> {
  const actionId = String(event['actionId'] ?? '');
  const colonIdx = actionId.indexOf(':');
  if (colonIdx === -1) return; // Malformed — all valid IDs carry the "commandName:" prefix

  const commandName = actionId.slice(0, colonIdx);
  const localActionId = actionId.slice(colonIdx + 1);

  const mod = commands.get(commandName);
  if (!mod || typeof mod['menu'] !== 'object' || !mod['menu']) return;
  // Respect config.platform[] — skip button action on platforms the module doesn't support
  if (!isPlatformAllowed(mod, native.platform)) return;

  const menu = mod['menu'] as Record<
    string,
    { run?: (...args: unknown[]) => Promise<void> }
  >;
  const handler = menu[localActionId];
  if (!handler || typeof handler.run !== 'function') return;

  // Build a full ctx mirroring what onCommand receives so run() handlers
  // can use chat.reply(), thread.getInfo(), etc. without special-casing.
  const thread = createThreadContext(api, event);
  const chat = createChatContext(
    api,
    event,
    commandName,
    mod['menu'] as Parameters<typeof createChatContext>[3],
  );
  const bot = createBotContext(api);
  const user = createUserContext(api);
  const logger = createLogger({
    userId: native.userId ?? '',
    platformId: (PLATFORM_TO_ID as Record<string, number>)[native.platform] ?? native.platform,
    sessionId: native.sessionId ?? '',
  });
  const ctx: BaseCtx = {
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
      users: {
        getName: getUserName,
      // Pre-scoped to session — button run() handlers can access collection(botUserId)
      collection: createCollectionManager(native.userId ?? '', native.platform, native.sessionId ?? ''),
    },
    threads: {
      getName: getThreadName,
      collection: createThreadCollectionManager(native.userId ?? '', native.platform, native.sessionId ?? ''),
    },
  },
};

  await handler.run(ctx).catch((err: unknown) => {
    console.error(`❌ Button action "${actionId}" failed`, err);
  });
}
