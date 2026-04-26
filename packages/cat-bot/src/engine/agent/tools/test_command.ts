/**
 * test_command Tool — Silent Command Execution with Full Output Capture
 *
 * Runs a bot command against a mock API proxy that intercepts every platform
 * side-effect (replyMessage, sendMessage, editMessage, etc.) and stores the
 * normalized results in commandResultStore under a unique lookup key.
 *
 * The agent receives:
 *   - `key`       — a composite lookup key to pass to send_result for delivery
 *   - `callCount` — how many API calls the command made
 *   - `calls`     — LLM-readable flat representation of each captured call,
 *                   including threadID, senderID, messageID, and all payload fields
 *
 * This replaces the old blind two-step pattern (test_command preview → execute_command
 * blind delivery) with an informed pipeline where the agent understands the full
 * command output before deciding to send it.
 *
 * Cooldown note: the cooldown window is intentionally NOT consumed during test_command
 * execution (consumeCooldown: false) so the agent can safely preview any command without
 * exhausting the user's rate limit.
 *
 * Binary fields (Readable streams, Buffers) in command output are replaced with
 * descriptive sentinel strings — they are single-use and cannot survive the mock
 * proxy invocation. URL-based attachments (attachment_url) survive normalization
 * and are included in the captured payload for delivery by send_result.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { inspectCommandConstraints } from '@/engine/agent/agent-command-guard.lib.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import {
  commandResultStore,
  normalizeToJson,
} from '../lib/command-result-store.lib.js';
import type { InterceptedCall } from '../lib/command-result-store.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'test_command',
  description:
    'Execute a command silently to intercept and preview its full output — messages, ' +
    'attachments, buttons, and any other platform API calls. Returns a lookup `key` and ' +
    'a `calls` array showing exactly what the command would send to the platform. ' +
    'After reviewing the captured output, call `send_result` with the key to deliver it. ' +
    'Do NOT use for commands that require the cooldown to be consumed on preview — ' +
    'this tool never advances the user\'s rate limit.',
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

// ============================================================================
// LLM-READABLE CALL FORMATTER
// ============================================================================

/**
 * Converts a raw InterceptedCall (positional args array) into a flat, named-field
 * object that is intuitive for an LLM to read.
 *
 * WHY: The Proxy-captured args mirror the UnifiedApi method signatures (positional),
 * which are opaque to the LLM. Formatting them into named fields (threadID, message,
 * attachment, etc.) makes the captured output immediately readable and actionable.
 *
 * senderID and messageID are injected from the triggering event context so the agent
 * understands the full conversation coordinates and can reason about reply threading.
 */
function formatCallForLLM(
  call: InterceptedCall,
  senderID: string,
  messageID: string,
): Record<string, unknown> {
  // Base context fields shared by all call types — give the LLM full conversation coordinates
  const base: Record<string, unknown> = { type: call.type, senderID, messageID };

  switch (call.type) {
    case 'replyMessage': {
      const [threadID, opts] = call.args as [string, Record<string, unknown>];
      return {
        ...base,
        threadID,
        message: opts?.['message'] ?? null,
        attachment: opts?.['attachment'] ?? null,
        attachment_url: opts?.['attachment_url'] ?? [],
        button: opts?.['button'] ?? [],
        reply_to_message_id: opts?.['reply_to_message_id'] ?? null,
        mentions: opts?.['mentions'] ?? [],
        style: opts?.['style'] ?? null,
      };
    }

    case 'sendMessage': {
      const [msg, threadID] = call.args as [unknown, string];
      if (typeof msg === 'string') {
        return { ...base, threadID, message: msg };
      }
      const payload = (msg ?? {}) as Record<string, unknown>;
      return {
        ...base,
        threadID,
        message: payload['message'] ?? payload['body'] ?? null,
        attachment: payload['attachment'] ?? null,
        attachment_url: payload['attachment_url'] ?? [],
        mentions: payload['mentions'] ?? [],
      };
    }

    case 'editMessage': {
      const [editMsgID, opts] = call.args as [string, unknown];
      if (typeof opts === 'string') {
        return { ...base, messageIDToEdit: editMsgID, message: opts };
      }
      const o = (opts ?? {}) as Record<string, unknown>;
      return {
        ...base,
        messageIDToEdit: editMsgID,
        message: o['message'] ?? null,
        button: o['button'] ?? [],
        style: o['style'] ?? null,
        attachment: o['attachment'] ?? null,
        attachment_url: o['attachment_url'] ?? [],
      };
    }

    case 'reactToMessage': {
      const [threadID, reactMsgID, emoji] = call.args as [string, string, string];
      return { ...base, threadID, reactToMessageID: reactMsgID, emoji };
    }

    case 'unsendMessage': {
      const [unsendMsgID] = call.args as [string];
      return { ...base, unsendMessageID: unsendMsgID };
    }

    case 'setNickname': {
      const [threadID, userID, nickname] = call.args as [string, string, string];
      return { ...base, threadID, userID, nickname };
    }

    case 'setGroupName': {
      const [threadID, name] = call.args as [string, string];
      return { ...base, threadID, name };
    }

    case 'setGroupImage': {
      const [threadID, imageSource] = call.args as [string, unknown];
      return { ...base, threadID, imageSource };
    }

    case 'removeGroupImage': {
      const [threadID] = call.args as [string];
      return { ...base, threadID };
    }

    case 'addUserToGroup': {
      const [threadID, userID] = call.args as [string, string];
      return { ...base, threadID, userID };
    }

    case 'removeUserFromGroup': {
      const [threadID, userID] = call.args as [string, string];
      return { ...base, threadID, userID };
    }

    case 'setGroupReaction': {
      const [threadID, emoji] = call.args as [string, string];
      return { ...base, threadID, emoji };
    }

    default:
      return { ...base, args: call.args };
  }
}

// ============================================================================
// TOOL RUN
// ============================================================================

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

    // Check constraints but do NOT consume the cooldown window during previews —
    // the agent may test the same command multiple times before deciding to send,
    // and consuming cooldown on a preview would erroneously throttle real user invocations.
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
    if (!guard.allowed) {
      return `Command '${command}' cannot be tested: ${guard.reason}`;
    }

    // All UnifiedApi side-effect methods the Proxy will intercept.
    // Read-only methods (getUserInfo, getBotID, getFullThreadInfo, etc.) are NOT
    // intercepted — they pass through to the real API so commands that query
    // user or thread data receive accurate live responses during preview.
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

    const rawIntercepted: Array<{ method: string; args: unknown[] }> = [];

    // Proxy intercepts side-effect calls and normalizes args immediately.
    // Normalization at capture time (not replay time) ensures streams are replaced
    // before the underlying Readable is consumed and becomes unreadable.
    const mockApi = new Proxy(ctx.api, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && sideEffects.has(prop)) {
          return async (...mArgs: unknown[]) => {
            rawIntercepted.push({
              method: prop,
              // Normalize each arg in-place — streams consumed by this mock call
              // cannot be re-read; sentinel strings preserve the structural information
              args: mArgs.map(normalizeToJson),
            });
            // Return a stable mock message ID so commands that chain on the returned
            // ID (e.g. state.create after chat.replyMessage) receive a valid string
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

    if (rawIntercepted.length === 0) {
      return (
        `Command '${command}' executed silently but produced no platform API calls. ` +
        `The command may use onChat-only logic, have conditional output that was not ` +
        `triggered by the provided arguments, or rely on side-effects not in the intercept list.`
      );
    }

    // Convert raw intercepts to the typed InterceptedCall format for storage
    const storableCalls: InterceptedCall[] = rawIntercepted.map((entry) => ({
      type: entry.method,
      args: entry.args,
    }));

    // Generate a unique key scoped to this session and store the calls.
    // The key is passed back to the agent who uses it with send_result.
    const key = commandResultStore.generateKey(sessionUserId, platform, sessionId);
    commandResultStore.set(key, storableCalls);

    // Build LLM-readable representations with named fields and event coordinates
    const eventMessageID = (ctx.event['messageID'] as string) || '';
    const llmCalls = storableCalls.map((call) =>
      formatCallForLLM(call, senderID, eventMessageID),
    );

    return JSON.stringify(
      {
        key,
        callCount: storableCalls.length,
        calls: llmCalls,
        note:
          'Review the captured calls above. To deliver this output to the user on the ' +
          'real platform, call `send_result` with the `key`. You can also describe the ' +
          'content conversationally in your reply text. Calls with [Stream/Buffer] ' +
          'attachment fields will have those attachments skipped on delivery.',
      },
      null,
      2,
    );
  } catch (err) {
    return `Error testing command: ${err instanceof Error ? err.message : String(err)}`;
  }
};