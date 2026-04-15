import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { inspectCommandConstraints } from '@/engine/agent/agent-command-guard.lib.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';

export const config = {
  name: 'execute_command',
  description:
    'Execute a specific bot command on behalf of the user. ' +
    'Only use commands that appear in the help tool output for this user.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command name without prefix (e.g. `admin`)',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to the command',
      },
    },
    required: ['command', 'args'],
  },
};

export const run = async (
  { command, args }: { command: string; args: string[] },
  ctx: AppCtx,
): Promise<string> => {
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);

  const mod = ctx.commands.get(command.toLowerCase());
  if (!mod || typeof mod['onCommand'] !== 'function') {
    return `Error: Command '${command}' not found.`;
  }

  try {
    const simulatedMessage =
      `${ctx.prefix || '/'}${command} ${(args || []).join(' ')}`.trim();
    const simulatedEvent = {
      ...ctx.event,
      message: simulatedMessage,
      body: simulatedMessage,
    };

    const commandCtx: OnCommandCtx = {
      ...ctx,
      event: simulatedEvent,
      parsed: { name: command, args: args || [] },
      prefix: ctx.prefix || '/',
      mod,
      options: OptionsMap.empty(),
    };

    const guard = await inspectCommandConstraints(
      mod,
      command.toLowerCase(),
      senderID,
      threadID,
      sessionUserId,
      platform,
      sessionId,
    );

    if (!guard.allowed) {
      return `Command '${command}' cannot be executed: ${guard.reason}`;
    }

    await dispatchCommand(
      ctx.commands,
      commandCtx.parsed!,
      commandCtx,
      ctx.api,
      threadID,
      commandCtx.prefix,
    );

    return `Command '${command}' executed successfully via simulated user input.`;
  } catch (err) {
    return `Error executing command: ${err instanceof Error ? err.message : String(err)}`;
  }
};
