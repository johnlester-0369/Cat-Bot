/**
 * Command Dispatcher — resolves and executes a single named command.
 *
 * Separated from the message handler so command resolution logic can be tested
 * in isolation without wiring up the full message pipeline.
 *
 * Middleware execution:
 *   1. Options seeded as OptionsMap.empty()
 *   2. validateCommandOptions middleware runs, parsing and validating
 *      required options, replacing ctx.options
 *   3. Final handler executes mod.onCommand with full context
 */

import type {
  CommandMap,
  ParsedCommand,
} from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import {
  createStateContext,
  createChatContext,
  createButtonContext,
} from '@/engine/adapters/models/context.model.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
// Shared usage guide factory — injected into AppCtx so onCommand handlers can
// call ctx.usage() to display a formatted guide when arguments are invalid/missing.
import { createUsage } from '@/engine/utils/usage.util.js';
import { createCurrenciesContext } from '@/engine/lib/currencies.lib.js';

/**
 * Dispatches a parsed command to its registered module.
 *
 * Steps:
 *   1. Look up command module by parsed.name
 *   2. Create state, command-specific chat context, execute
 *
 * If command module is missing or lacks onCommand handler, returns silently.
 */
export async function dispatchCommand(
  commands: CommandMap,
  parsed: ParsedCommand,
  ctx: OnCommandCtx,
  api: UnifiedApi,
  _threadID: string,
  _prefix: string,
): Promise<void> {
  const mod = ctx.mod;
  if (!mod || typeof mod['onCommand'] !== 'function') return;
  // Respect config.platform[] — silently skip command if the current platform is excluded
  if (!isPlatformAllowed(mod, ctx.native?.platform)) return;

  // State and commandChat built inside the final handler so any ctx mutations
  // applied by earlier middleware (e.g. a future auth middleware attaching a user
  // profile to ctx) are visible when the handler executes.
  const { state } = createStateContext(parsed.name, ctx.event);
  const { button } = createButtonContext(parsed.name, ctx.event);
  // Command-name-aware chat context resolves bare button IDs to "commandName:buttonId"
  // callback payloads at dispatch time so button handlers route back to the right command.
  const commandChat = createChatContext(
    api,
    ctx.event,
    parsed.name,
    (mod['button'] as Record<
      string,
      {
        label?: string;
        style?: import('@/engine/constants/button-style.constants.js').ButtonStyleValue;
        onClick?: (...args: unknown[]) => unknown;
      }
    >) ?? null,
  );

  // Bind the usage guide to this command and the resolved chat context.
  const usage = createUsage(mod, commandChat, _prefix);

  await (mod['onCommand'] as (ctx: unknown) => Promise<void>)({
    ...ctx,
    args: parsed.args,
    state,
    button,
    chat: commandChat,
    usage,
    session: { id: '', context: {} },
    emoji: '',
    messageID: (ctx.event['messageID'] as string) || '',
    currencies: createCurrenciesContext(ctx.native.userId ?? '', ctx.native.platform, ctx.native.sessionId ?? ''),
  }).catch((err: unknown) => {
    console.error(`❌ Command "${parsed.name}" failed`, err);
  });
}
