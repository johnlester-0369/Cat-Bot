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
import type { Readable } from 'node:stream';
import { resolveAgentContext } from '../agent.util.js';
import { inspectCommandConstraints } from '@/engine/agent/agent-command-guard.lib.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import {
  commandResultStore,
  normalizeToJson,
} from '../lib/command-result-store.lib.js';
import type { InterceptedCall, BinaryAttachment } from '../lib/command-result-store.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'test_command',
  description:
    'Execute commands silently to intercept and preview their output. Always use the ' +
    '`commands` array — the legacy single-command shorthand has been removed. Returns ' +
    'a `key` and a `calls` array. When the combined output across all commands contains ' +
    'more than one attachment, `button_key` is automatically null because platforms ' +
    'cannot deliver multiple file attachments alongside interactive button components.',
  parameters: {
    type: 'object',
    properties: {
      commands: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command name without prefix' },
            args: { type: 'array', items: { type: 'string' }, description: 'Arguments' },
          },
          required: ['command', 'args'],
        },
        description: 'List of commands to test in sequence.',
      },
    },
    required: ['commands'],
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
  const base: Record<string, unknown> = { type: call.type, senderID, messageID };
  if (call.sourceCommand) base.sourceCommand = call.sourceCommand;

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
// BINARY ATTACHMENT EXTRACTOR
// ============================================================================

/**
 * Extracts Buffer-based attachment payloads from raw (pre-normalization) UnifiedApi call args.
 * MUST be called before mArgs.map(normalizeToJson) — once normalizeToJson executes,
 * every Buffer is replaced with BUFFER_SENTINEL and the raw bytes are permanently gone.
 *
 * Options position per method:
 *   replyMessage / editMessage → options object at args[1], attachment[] at opts.attachment
 *   sendMessage                → payload at args[0] when it is an object (not a bare string)
 */
function extractBinaryAttachments(
  method: string,
  args: unknown[],
): BinaryAttachment[] {
  let opts: Record<string, unknown> | null = null;
  if (method === 'replyMessage' || method === 'editMessage') {
    opts = (args[1] ?? {}) as Record<string, unknown>;
  } else if (method === 'sendMessage') {
    const p = args[0];
    if (p !== null && typeof p === 'object' && !Array.isArray(p))
      opts = p as Record<string, unknown>;
  }
  if (!opts || !Array.isArray(opts['attachment'])) return [];

  const result: BinaryAttachment[] = [];
  for (const a of opts['attachment'] as unknown[]) {
    if (a !== null && typeof a === 'object') {
      const entry = a as Record<string, unknown>;
      const stream = entry['stream'];
      // Duck-type Readable detection mirrors normalizeToJson — .pipe presence is
      // definitive for all Node Readable variants (PassThrough, Transform, fs.ReadStream, etc.).
      // Must be evaluated BEFORE mArgs.map(normalizeToJson) replaces the stream with
      // STREAM_SENTINEL — once normalized, the original reference is gone.
      const isReadable =
        stream !== null &&
        typeof stream === 'object' &&
        typeof (stream as Record<string, unknown>)['pipe'] === 'function';
      if (Buffer.isBuffer(stream)) {
        result.push({ name: String(entry['name'] ?? 'attachment'), stream });
      } else if (isReadable) {
        result.push({
          name: String(entry['name'] ?? 'attachment'),
          stream: stream as Readable,
        });
      }
    }
  }
  return result;
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  payload: { commands: Array<{ command: string; args: string[] }> },
  ctx: AppCtx,
): Promise<string> => {
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);

  const cmdsToRun = payload.commands ?? [];
  if (cmdsToRun.length === 0) {
    return 'Error: You must provide a non-empty `commands` array.';
  }

  try {
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

    const rawIntercepted: Array<{ method: string; args: unknown[]; sourceCommand: string }> = [];
    let currentRunningCommand = '';

    // Captures Buffer payloads BEFORE normalization — extracted per-call inside the Proxy
    // so mArgs.map(normalizeToJson) has not yet replaced them with BUFFER_SENTINEL.
    const rawBinaryAttachments: BinaryAttachment[] = [];

    const mockApi = new Proxy(ctx.api, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && sideEffects.has(prop)) {
          return async (...mArgs: unknown[]) => {
            // Extract Buffer attachments BEFORE normalization — unrecoverable after normalizeToJson
            for (const b of extractBinaryAttachments(prop, mArgs)) {
              rawBinaryAttachments.push(b);
            }
            rawIntercepted.push({
              method: prop,
              args: mArgs.map(normalizeToJson),
              sourceCommand: currentRunningCommand,
            });
            return 'mock-msg-id';
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const errors: string[] = [];

    for (const cmdObj of cmdsToRun) {
      const command = cmdObj.command;
      const args = cmdObj.args || [];
      currentRunningCommand = command;

      const mod = ctx.commands.get(command.toLowerCase());
      if (!mod || typeof mod['onCommand'] !== 'function') {
        errors.push(`Command '${command}' not found.`);
        continue;
      }

      const simulatedMessage =
        `${ctx.prefix || '/'}${command} ${(args || []).join(' ')}`.trim();
      const simulatedEvent = {
        ...ctx.event,
        message: simulatedMessage,
        body: simulatedMessage,
      };

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
        errors.push(`Command '${command}' blocked: ${guard.reason}`);
        continue;
      }

      const commandCtx: OnCommandCtx = {
        ...ctx,
        api: mockApi,
        event: simulatedEvent,
        parsed: { name: command, args },
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
    }

    if (rawIntercepted.length === 0) {
      if (errors.length > 0) return `Execution errors: ${errors.join(' ')}`;
      return `Commands executed silently but produced no API calls.`;
    }

    // Convert raw intercepts to the typed InterceptedCall format for storage
    const storableCalls: InterceptedCall[] = rawIntercepted.map((entry) => ({
      type: entry.method,
      args: entry.args,
      sourceCommand: entry.sourceCommand,
    }));

    // Hoisted for key generation and llm formatting
    const eventMessageID = (ctx.event['messageID'] as string) || '';

    // Generate a unique key scoped to this session and store the calls.
    // The key is passed back to the agent who uses it with send_result.
    const commandNames = cmdsToRun.map((c) => c.command).join(',');
    const key = commandResultStore.generateKey(sessionUserId, platform, sessionId, threadID, eventMessageID, commandNames);
    commandResultStore.set(key, storableCalls);

    // Extract URL-based attachments and button grids into separate, independently-keyed
    // stores so send_result can merge results from multiple concurrent command runs into
    // one platform message. Streams/Buffers were already replaced with sentinels by
    // normalizeToJson during capture, so only safe URL strings remain in attachment_url.
    const collectedAttachments: Array<{ name: string; url: string }> = [];
    const collectedButtonGrids: Array<Array<Array<Record<string, unknown>>>> = [];
    // Tracks how many stream/buffer attachment slots were consumed across all commands.
    let streamAttachmentCount = 0;

    for (const call of storableCalls) {
      const isReply = call.type === 'replyMessage';
      const isEdit = call.type === 'editMessage';
      const isSend = call.type === 'sendMessage';
      // replyMessage/editMessage: options are arg[1]; sendMessage: payload may be arg[0] object
      const opts: Record<string, unknown> | null =
        isReply || isEdit
          ? ((call.args[1] ?? {}) as Record<string, unknown>)
          : isSend && typeof call.args[0] === 'object' && call.args[0] !== null
            ? (call.args[0] as Record<string, unknown>)
            : null;

      if (!opts) continue;

      if (Array.isArray(opts['attachment_url'])) {
        for (const u of opts['attachment_url'] as Array<{
          name: string;
          url: string;
        }>) {
          if (u && typeof u.url === 'string') collectedAttachments.push(u);
        }
      }
      // Stream/Buffer attachments are replaced by sentinels during normalizeToJson capture
      // and cannot be replayed — but they still occupy an attachment slot on the platform.
      // Counting them here ensures the button-stripping guard sees the full attachment footprint.
      if (Array.isArray(opts['attachment'])) {
        streamAttachmentCount += (opts['attachment'] as unknown[]).length;
      }
      // Only reply/edit calls carry button grids; sendMessage has no button parameter
      if (
        (isReply || isEdit) &&
        Array.isArray(opts['button']) &&
        (opts['button'] as unknown[]).length > 0
      ) {
        collectedButtonGrids.push(
          opts['button'] as Array<Array<Record<string, unknown>>>,
        );
      }
    }

    // Strip buttons when the total attachment count across all commands exceeds one —
    // Discord, Telegram, and Facebook all reject multiple file attachments alongside
    // interactive button components. Single attachment + buttons is fine; two or more forces removal.
    const totalAttachments = collectedAttachments.length + streamAttachmentCount;
    const attachmentKey = collectedAttachments.length > 0 ? `${key}:a` : null;
    const buttonKey =
      collectedButtonGrids.length > 0 && totalAttachments <= 1 ? `${key}:b` : null;
    if (attachmentKey)
      commandResultStore.setAttachments(attachmentKey, collectedAttachments);
    if (buttonKey)
      commandResultStore.setButtons(buttonKey, collectedButtonGrids);
    const binaryKey = rawBinaryAttachments.length > 0 ? `${key}:bin` : null;
    if (binaryKey)
      commandResultStore.setBinaryAttachments(binaryKey, rawBinaryAttachments);

    // Build LLM-readable representations with named fields and event coordinates
    const llmCalls = storableCalls.map((call) =>
      formatCallForLLM(call, senderID, eventMessageID),
    );

    return JSON.stringify(
      {
        key,
        attachment_key: attachmentKey,
        binary_attachment_key: binaryKey,
        button_key: buttonKey,
        callCount: storableCalls.length,
        calls: llmCalls,
        note:
          'Read the `calls` text to synthesize your reply message. Then call ' +
          '`send_result` once with your synthesized `message` text. Pass ' +
          '`attachment_key` (if non-null) in the `attachment_url` array, ' +
          '`binary_attachment_key` (if non-null) in the `attachment` array, ' +
          'and `button_key` (if non-null) in the `button` array. Run all ' +
          'needed test_command calls first, then combine into one send_result call.',
      },
      null,
      2,
    );
  } catch (err) {
    return `Error testing command: ${err instanceof Error ? err.message : String(err)}`;
  }
};
