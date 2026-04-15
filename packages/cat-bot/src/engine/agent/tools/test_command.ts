import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { inspectCommandConstraints } from '@/engine/agent/agent-command-guard.lib.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';

export const config = {
  name: 'test_command',
  description:
    'Execute a command silently to see its output without sending it to the user. ' +
    'Use this to fetch information (like balances, user data) so you can read it ' +
    'and formulate a conversational reply. Do NOT use this for random generators (like memes).',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command name without prefix (e.g. `balance`)',
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

    // Check constraints but do NOT consume the cooldown window during previews
    const guard = await inspectCommandConstraints(
      mod,
      command.toLowerCase(),
      senderID,
      threadID,
      sessionUserId,
      platform,
      sessionId,
      false,
    );
    if (!guard.allowed)
      return `Command '${command}' cannot be tested: ${guard.reason}`;

    const intercepted: unknown[] = [];
    const sideEffects = new Set([
      'replyMessage',
      'sendMessage',
      'editMessage',
      'reactToMessage',
      'unsendMessage',
      'setNickname',
      'setGroupName',
      'setGroupImage',
      'removeGroupImage',
      'addUserToGroup',
      'removeUserFromGroup',
      'setGroupReaction',
    ]);

    // Proxy the API to intercept message sends/edits/replies safely
    const mockApi = new Proxy(ctx.api, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && sideEffects.has(prop)) {
          return async (...mArgs: unknown[]) => {
            intercepted.push({ method: prop, args: mArgs });
            return 'mock-msg-id';
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const commandCtx: OnCommandCtx = {
      ...ctx,
      api: mockApi,
      event: simulatedEvent,
      parsed: { name: command, args: args || [] },
      prefix: ctx.prefix || '/',
      mod,
      options: OptionsMap.empty(),
    };

    await dispatchCommand(
      ctx.commands,
      commandCtx.parsed!,
      commandCtx,
      mockApi,
      threadID,
      commandCtx.prefix,
    );

    if (intercepted.length === 0) {
      return `Command '${command}' executed silently but produced no output.`;
    }

    // Handle circular references gracefully if commands dump streams or raw buffers
    const cache = new Set();
    return JSON.stringify(
      intercepted,
      (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) return '[Circular]';
          cache.add(value);
        }
        return typeof value === 'bigint' ? value.toString() : value;
      },
      2,
    );
  } catch (err) {
    return `Error testing command: ${err instanceof Error ? err.message : String(err)}`;
  }
};
