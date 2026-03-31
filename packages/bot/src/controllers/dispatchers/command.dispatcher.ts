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
  BaseCtx,
  CommandMap,
  ParsedCommand,
} from '@/types/controller.types.js';
import type { UnifiedApi } from '@/adapters/models/api.model.js';
import {
  createStateContext,
  createChatContext,
} from '@/adapters/models/context.model.js';
// OptionsMap needed to seed commandCtx.options before validateCommandOptions middleware
import { OptionsMap } from '@/lib/options-map.lib.js';
// Middleware chain runner and registry — validateCommandOptions executes
// before the final handler dispatches to the command module.
import {
  middlewareRegistry,
  runMiddlewareChain,
} from '@/lib/middleware.lib.js';
import type { OnCommandCtx } from '@/types/middleware.types.js';
// Platform filter — enforces config.platform[] declared by each command module
import { isPlatformAllowed } from '@/utils/platform-filter.util.js';

/**
 * Dispatches a parsed command to its registered module.
 *
 * Steps:
 *   1. Look up command module by parsed.name
 *   2. Build OnCommandCtx with empty options (validateCommandOptions will fill)
 *   3. Run onCommand middleware chain (options parsing/validation)
 *   4. In final handler: create state, command-specific chat context, execute
 *
 * If command module is missing or lacks onCommand handler, returns silently.
 */
export async function dispatchCommand(
  commands: CommandMap,
  parsed: ParsedCommand,
  ctx: BaseCtx,
  api: UnifiedApi,
  threadID: string,
  prefix: string,
): Promise<void> {
  const mod = commands.get(parsed.name);
  if (!mod) return;
  if (typeof mod['onCommand'] !== 'function') return;
  // Respect config.platform[] — silently skip command if the current platform is excluded
  if (!isPlatformAllowed(mod, ctx.native?.platform)) return;

  // Build extended context for the onCommand middleware chain.
  // options is seeded as OptionsMap.empty() here; validateCommandOptions middleware
  // replaces it after parsing and validating the message body / optionsRecord.
  const commandCtx: OnCommandCtx = {
    ...ctx,
    parsed,
    prefix,
    mod,
    options: OptionsMap.empty(),
  };

  await runMiddlewareChain<OnCommandCtx>(
    middlewareRegistry.getOnCommand(),
    commandCtx,
    async () => {
      // State and commandChat built inside the final handler so any ctx mutations
      // applied by earlier middleware (e.g. a future auth middleware attaching a user
      // profile to ctx) are visible when the handler executes.
      const { state } = createStateContext(parsed.name, ctx.event);
      // Command-name-aware chat context resolves bare action IDs to "commandName:actionId"
      // callback payloads at dispatch time so button handlers route back to the right command.
      const commandChat = createChatContext(
        api,
        ctx.event,
        parsed.name,
        (mod['menu'] as Record<
          string,
          {
            label?: string;
            button_style?: string;
            run?: (...args: unknown[]) => unknown;
          }
        >) ?? null,
      );

      await (mod['onCommand'] as (ctx: unknown) => Promise<void>)({
        ...commandCtx,
        args: parsed.args,
        state,
        chat: commandChat,
      }).catch((err: unknown) => {
        console.error(`❌ Command "${parsed.name}" failed`, err);
      });
    },
  );
}
