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
} from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { runOnChat } from '../on-chat-runner.js';
import { dispatchOnReply } from '../dispatchers/reply.dispatcher.js';
import { dispatchCommand } from '../dispatchers/command.dispatcher.js';
import { parseCommand } from '@/engine/utils/command-parser.util.js';
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/engine/lib/middleware.lib.js';
import type { OnChatCtx, OnCommandCtx } from '@/engine/types/middleware.types.js';
import { findSimilarCommand } from '@/engine/utils/command-suggest.util.js';
import { OptionsMap } from '@/engine/lib/options-map.lib.js';
import { isCommandEnabled, findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/utils/platform-filter.util.js';
// BaseCtx construction delegated to shared factory — eliminates ~35-line duplication across handlers
import { buildBaseCtx } from '../factories/ctx.factory.js';

/**
 * Returns the set of command names disabled by the bot admin for this session.
 *
 * Only invoked on the rare "unknown / disabled command" code path — never on every
 * message. An empty set is returned on DB error (fail-open) so "did you mean?"
 * suggestions continue to function even when the DB is temporarily unreachable.
 */
async function getDisabledNamesForSession(native: NativeContext, commands: CommandMap): Promise<Set<string>> {
  const disabledNames = new Set<string>();

  // Pre-populate with commands not supported on this platform so they are omitted from suggestions
  for (const mod of commands.values()) {
    const cfg = mod['config'] as { name?: string } | undefined;
    if (cfg?.name && !isPlatformAllowed(mod, native.platform)) {
      disabledNames.add(cfg.name.toLowerCase());
    }
  }

  const sessionUserId = native.userId ?? '';
  const sessionId = native.sessionId ?? '';
  if (!sessionUserId || !sessionId) return disabledNames;
  try {
    const rows = await findSessionCommands(sessionUserId, native.platform, sessionId);
    for (const r of rows) {
      if (!r.isEnable) disabledNames.add(r.commandName);
    }
    return disabledNames;
  } catch {
    // Fail-open: suggestions still function without disabled-command filtering on DB error
    return disabledNames;
  }
}

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
  const baseCtx = buildBaseCtx(api, event, commands, native, prefix);
  // Destructure chat for direct use in the "no prefix" and "command not found" reply paths below
  const { chat } = baseCtx;

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
  const args = body.trim().split(/\s+/).filter(Boolean);

  let isCommandInvocation = false;
  let parsed: import('@/engine/types/controller.types.js').ParsedCommand | undefined;
  let mod: import('@/engine/types/controller.types.js').CommandModule | undefined;

  // Prefix commands vs. Prefix-less commands
  if (body.startsWith(prefix)) {
    isCommandInvocation = true;
    parsed = parseCommand(args, prefix) ?? undefined;
    if (parsed) {
      mod = commands.get(parsed.name);
      // Nullify unsupported commands so they fallback to "command not found" logic naturally
      if (mod && !isPlatformAllowed(mod, native.platform)) {
        mod = undefined;
      }
    }
  } else if (args.length > 0) {
    const firstToken = args[0]!.toLowerCase();
    const noPrefixMod = commands.get(firstToken);
    const noPrefixCfg = noPrefixMod?.['config'] as Record<string, unknown> | undefined;
    if (noPrefixCfg?.['hasPrefix'] === false) {
      if (noPrefixMod && isPlatformAllowed(noPrefixMod, native.platform)) {
        isCommandInvocation = true;
        parsed = { name: firstToken, args: args.slice(1) };
        mod = noPrefixMod;
      }
    }
  }

  // Intercept valid invocations and unrecognized prefix sequences for onCommand middleware execution
  if (isCommandInvocation) {
    const commandCtx: OnCommandCtx = {
      ...baseCtx,
      parsed,
      prefix,
      mod,
      options: OptionsMap.empty(),
    };

    await runMiddlewareChain<OnCommandCtx>(
      middlewareRegistry.getOnCommand(),
      commandCtx,
      async () => {
        // Handle raw prefixes that result in no resolvable command after parsing
        if (!commandCtx.parsed && body.startsWith(prefix)) {
          await chat.replyMessage({ message: `Type ${prefix}help for available commands.` });
          return;
        }
        if (!commandCtx.parsed) return;

        const p = commandCtx.parsed;
        const m = commandCtx.mod;

        if (!m) {
          const disabledNames = await getDisabledNamesForSession(native, commands);
          const suggestion = findSimilarCommand(p.name, commands, disabledNames);
          await chat.replyMessage({
            message: suggestion
              ? `No command "${p.name}" found. Did you mean "${suggestion}"?`
              : `No command "${p.name}" found. Type ${prefix}help for available commands.`,
          });
          return;
        }

        const matchedCfg = m['config'] as { name?: string } | undefined;
        const canonicalName = (matchedCfg?.name ?? p.name).toLowerCase();
        const sessionUserId = native.userId ?? '';
        const sessionId = native.sessionId ?? '';

        if (sessionUserId && sessionId) {
          const enabled = await isCommandEnabled(sessionUserId, native.platform, sessionId, canonicalName);
          if (!enabled) {
            const disabledNames = await getDisabledNamesForSession(native, commands);
            disabledNames.add(canonicalName);
            const suggestion = findSimilarCommand(p.name, commands, disabledNames);
            await chat.replyMessage({
              message: suggestion
                ? `No command "${p.name}" found. Did you mean "${suggestion}"?`
                : `No command "${p.name}" found. Type ${prefix}help for available commands.`,
            });
            return;
          }
        }

        await dispatchCommand(commands, p, commandCtx, api, event['threadID'] as string, prefix);
      }
    );
  }
}
