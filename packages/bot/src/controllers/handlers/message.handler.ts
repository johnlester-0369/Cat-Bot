/**
 * Message Handler — main entry point for all incoming messages.
 *
 * Orchestrates the message pipeline in strict order:
 *   1. onChat fan-out (passive middleware like logging)
 *   2. onReply state check (continuing a conversation flow)
 *   3. Prefix parsing + command dispatch (new command execution)
 *
 * Steps 1–2 run before any prefix check so reply flows are never blocked
 * by a user forgetting the prefix.
 */

import type {
  BaseCtx,
  CommandMap,
  EventModuleMap,
  NativeContext,
} from '@/types/controller.types.js';
import type { UnifiedApi } from '@/adapters/models/api.model.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/adapters/models/context.model.js';
import { runOnChat } from '../on-chat-runner.js';
import { dispatchOnReply } from '../dispatchers/reply.dispatcher.js';
import { dispatchCommand } from '../dispatchers/command.dispatcher.js';
import { parseCommand } from '@/utils/command-parser.util.js';
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/lib/middleware.lib.js';
import type { OnChatCtx } from '@/types/middleware.types.js';

/**
 * Main entry point for incoming messages.
 * - Runs onChat for all commands (passive middleware)
 * - Checks for pending onReply states before command dispatch
 * - If message starts with prefix, parses and dispatches command
 */
export async function handleMessage(
  api: UnifiedApi,
  event: Record<string, unknown>,
  commands: CommandMap,
  eventModules: EventModuleMap,
  prefix: string,
  native: NativeContext = { platform: 'unknown' },
): Promise<void> {
  const thread = createThreadContext(api, event);
  const chat = createChatContext(api, event);
  const bot = createBotContext(api);
  const user = createUserContext(api);
  const baseCtx: BaseCtx = {
    api,
    event,
    commands,
    prefix,
    thread,
    chat,
    bot,
    user,
    native,
  };

  // Run global onChat middleware chain before the module fan-out — cross-cutting
  // concerns (rate limiting, audit logging, spam detection) intercept every message
  // here before individual command modules' onChat handlers process it.
  await runMiddlewareChain<OnChatCtx>(
    middlewareRegistry.getOnChat(),
    baseCtx,
    () => runOnChat(commands, baseCtx),
  );

  // Check for a registered onReply state BEFORE prefix parsing — a user quoting a pending
  // bot message is continuing a conversation flow, not issuing a new command.
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  if (messageReply?.['messageID']) {
    const handled = await dispatchOnReply(commands, event, baseCtx);
    if (handled) return;
  }

  const body = (event['message'] ?? event['body'] ?? '') as string;
  if (!body.startsWith(prefix)) {
    // hasPrefix: false — allows a command to be invoked without the prefix character.
    // The prefix check lives here at the routing layer because the early return fires
    // before the dispatcher is ever reached; there is nowhere inside on-command.middleware
    // that could intercept a no-prefix message that has already been discarded.
    const tokens = body.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const firstToken = tokens[0]!.toLowerCase();
      const noPrefixMod = commands.get(firstToken);
      const noPrefixCfg = noPrefixMod?.['config'] as
        | Record<string, unknown>
        | undefined;
      if (noPrefixCfg?.['hasPrefix'] === false) {
        await dispatchCommand(
          commands,
          { name: firstToken, args: tokens.slice(1) },
          baseCtx,
          api,
          event['threadID'] as string,
          prefix,
        );
      }
    }
    return;
  }

  const args = body.trim().split(/\s+/).filter(Boolean);
  const parsed = parseCommand(args, prefix);
  if (!parsed) {
    await chat.replyMessage({
      message: `❓ Type ${prefix}help for available commands.`,
    });
    return;
  }

  await dispatchCommand(
    commands,
    parsed,
    baseCtx,
    api,
    event['threadID'] as string,
    prefix,
  );
}
