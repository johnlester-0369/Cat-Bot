/**
 * send_result Tool — Replay Captured Command Output to the Real Platform
 *
 * After test_command captures and stores a command's API calls under a lookup key,
 * the agent calls this tool with that key to actually deliver the output to the user
 * on the live chat platform. This closes the loop of the informed delivery pipeline:
 *
 *   help → test_command (preview + store) → send_result (replay from store)
 *
 * Replay fidelity per field type:
 *   - Text messages (message, body)      → replayed exactly
 *   - URL attachments (attachment_url)   → replayed exactly (strings survive normalization)
 *   - Buttons (button: ButtonItem[][])   → replayed exactly (JSON-serializable)
 *   - Mentions                           → replayed exactly
 *   - Stream attachments (attachment)    → SKIPPED — Readable streams are single-use;
 *                                          they were consumed by the mock proxy during
 *                                          test_command and cannot be re-read for replay
 *   - Buffer attachments (setGroupImage) → SKIPPED for same reason; flagged in result
 *
 * The lookup entry is deleted from commandResultStore after replay (success or partial
 * failure) to prevent unbounded memory growth. An unconsumed entry (agent decided not
 * to send) remains in memory until the next process restart — acceptable because
 * entries are small and agent turn frequency is low.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import {
  commandResultStore,
  STREAM_SENTINEL,
  BUFFER_SENTINEL,
} from '../lib/command-result-store.lib.js';
import type { InterceptedCall } from '../lib/command-result-store.lib.js';
import type {
  ReplyMessageOptions,
  EditMessageOptions,
} from '@/engine/adapters/models/interfaces/api.interfaces.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';

// ============================================================================
// REPLAY HELPERS
// ============================================================================

/**
 * Returns true when a value is a binary sentinel string written by normalizeToJson.
 * Used to guard fields that cannot be replayed (consumed streams, Buffers).
 */
function isBinarySentinel(value: unknown): boolean {
  return value === STREAM_SENTINEL || value === BUFFER_SENTINEL;
}

/**
 * Replays a single InterceptedCall against the real UnifiedApi.
 *
 * Design decisions:
 *   - `attachment` (stream-based) is ALWAYS skipped — streams were consumed during
 *     the mock proxy invocation and the sentinel string cannot be forwarded as a stream.
 *   - `attachment_url` IS included — URL strings survive normalization and the platform
 *     wrapper will download them fresh on delivery.
 *   - `button` (ButtonItem[][]) IS included — the items are { id, label, style } plain
 *     objects, fully JSON-serializable and safe to pass directly.
 *   - `setGroupImage` with a sentinel arg is surfaced as a warning, not a hard failure,
 *     so the agent can still confirm partial success to the user.
 *
 * Returns a one-line outcome description the agent includes in its reply text.
 */
async function replayCall(
  api: UnifiedApi,
  call: InterceptedCall,
): Promise<string> {
  switch (call.type) {
    case 'replyMessage': {
      const [threadID, rawOpts] = call.args as [string, Record<string, unknown>];
      const options: ReplyMessageOptions = {};

      if (typeof rawOpts?.['message'] === 'string') options.message = rawOpts['message'];
      // Skip stream attachment — single-use, consumed during test preview
      // URL-based attachments survive normalization and can be delivered
      if (Array.isArray(rawOpts?.['attachment_url'])) {
        options.attachment_url = rawOpts['attachment_url'] as ReplyMessageOptions['attachment_url'];
      }
      if (Array.isArray(rawOpts?.['button'])) {
        options.button = rawOpts['button'] as ReplyMessageOptions['button'];
      }
      if (typeof rawOpts?.['reply_to_message_id'] === 'string') {
        options.reply_to_message_id = rawOpts['reply_to_message_id'];
      }
      if (Array.isArray(rawOpts?.['mentions'])) {
        options.mentions = rawOpts['mentions'] as ReplyMessageOptions['mentions'];
      }
      if (rawOpts?.['style']) {
        options.style = rawOpts['style'] as ReplyMessageOptions['style'];
      }

      await api.replyMessage(threadID, options);
      return `✓ replyMessage → thread ${threadID}`;
    }

    case 'sendMessage': {
      const [msg, threadID] = call.args as [unknown, string];
      if (typeof msg === 'string') {
        await api.sendMessage(msg, threadID);
      } else {
        // msg is a normalized SendPayload — extract text fields only
        const payload = (msg ?? {}) as Record<string, unknown>;
        const text =
          (payload['message'] as string | undefined) ??
          (payload['body'] as string | undefined) ??
          '';
        await api.sendMessage(text, threadID);
      }
      return `✓ sendMessage → thread ${threadID}`;
    }

    case 'editMessage': {
      const [messageID, rawOpts] = call.args as [string, unknown];
      if (typeof rawOpts === 'string') {
        // Simple string edit — no options object
        await api.editMessage(messageID, rawOpts);
        return `✓ editMessage → message ${messageID}`;
      }
      const opts = (rawOpts ?? {}) as Record<string, unknown>;
      const options: EditMessageOptions = {};
      if (typeof opts['message'] === 'string') options.message = opts['message'];
      if (opts['style']) options.style = opts['style'] as EditMessageOptions['style'];
      if (Array.isArray(opts['button'])) {
        options.button = opts['button'] as EditMessageOptions['button'];
      }
      if (typeof opts['message_id_to_edit'] === 'string') {
        options.message_id_to_edit = opts['message_id_to_edit'];
      }
      if (typeof opts['threadID'] === 'string') options.threadID = opts['threadID'];
      if (Array.isArray(opts['attachment_url'])) {
        options.attachment_url = opts['attachment_url'] as EditMessageOptions['attachment_url'];
      }
      await api.editMessage(messageID, options);
      return `✓ editMessage → message ${messageID}`;
    }

    case 'reactToMessage': {
      const [threadID, reactMsgID, emoji] = call.args as [string, string, string];
      await api.reactToMessage(threadID, reactMsgID, emoji);
      return `✓ reactToMessage → ${emoji} on message ${reactMsgID}`;
    }

    case 'unsendMessage': {
      const [msgID] = call.args as [string];
      await api.unsendMessage(msgID);
      return `✓ unsendMessage → message ${msgID}`;
    }

    case 'setNickname': {
      const [threadID, userID, nickname] = call.args as [string, string, string];
      await api.setNickname(threadID, userID, nickname);
      return `✓ setNickname → "${nickname}" for user ${userID}`;
    }

    case 'setGroupName': {
      const [threadID, name] = call.args as [string, string];
      await api.setGroupName(threadID, name);
      return `✓ setGroupName → "${name}" in thread ${threadID}`;
    }

    case 'setGroupImage': {
      const [threadID, imageSource] = call.args as [string, unknown];
      // Image must be a non-sentinel URL string — Buffer/Stream cannot be replayed
      if (isBinarySentinel(imageSource)) {
        return (
          `⚠ setGroupImage skipped → image was a stream or Buffer captured during ` +
          `test_command and cannot be replayed (single-use binary data)`
        );
      }
      if (typeof imageSource !== 'string') {
        return `⚠ setGroupImage skipped → image source is not a replayable URL string`;
      }
      await api.setGroupImage(threadID, imageSource);
      return `✓ setGroupImage → thread ${threadID}`;
    }

    case 'removeGroupImage': {
      const [threadID] = call.args as [string];
      await api.removeGroupImage(threadID);
      return `✓ removeGroupImage → thread ${threadID}`;
    }

    case 'addUserToGroup': {
      const [threadID, userID] = call.args as [string, string];
      await api.addUserToGroup(threadID, userID);
      return `✓ addUserToGroup → user ${userID} into thread ${threadID}`;
    }

    case 'removeUserFromGroup': {
      const [threadID, userID] = call.args as [string, string];
      await api.removeUserFromGroup(threadID, userID);
      return `✓ removeUserFromGroup → user ${userID} from thread ${threadID}`;
    }

    case 'setGroupReaction': {
      const [threadID, emoji] = call.args as [string, string];
      await api.setGroupReaction(threadID, emoji);
      return `✓ setGroupReaction → ${emoji} in thread ${threadID}`;
    }

    default:
      return `⚠ Unknown call type '${call.type}' — skipped (no replay handler defined)`;
  }
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'send_result',
  description:
    'Deliver the captured output from test_command to the real chat platform. ' +
    'Provide the `key` returned by test_command. All intercepted API calls ' +
    '(messages, reactions, group name changes, etc.) are replayed against the live ' +
    'platform in the order they were captured. Stream and Buffer attachments are ' +
    'automatically skipped — only text, URL-based attachments, and buttons are delivered. ' +
    'The lookup entry is deleted after replay so each key can only be used once.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'The lookup key returned by test_command ' +
          '(format: sessionUserId:platform:sessionId:n)',
      },
    },
    required: ['key'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  { key }: { key: string },
  ctx: AppCtx,
): Promise<string> => {
  const calls = commandResultStore.get(key);

  if (!calls) {
    return (
      `Error: No command result found for key '${key}'. ` +
      `The result may have already been delivered (each key is single-use), ` +
      `or the key is invalid. Run test_command again to capture a fresh result.`
    );
  }

  if (calls.length === 0) {
    commandResultStore.delete(key);
    return `No API calls to replay for key '${key}'.`;
  }

  const outcomes: string[] = [];
  let hasError = false;

  for (const call of calls) {
    try {
      const outcome = await replayCall(ctx.api, call);
      outcomes.push(outcome);
    } catch (err) {
      const msg = `✗ ${call.type} failed: ${err instanceof Error ? err.message : String(err)}`;
      outcomes.push(msg);
      hasError = true;
    }
  }

  // Always delete after processing — even on partial failure — to prevent
  // the agent from re-sending already-delivered calls on a retry attempt.
  commandResultStore.delete(key);

  const summary = hasError
    ? `Delivered ${calls.length} call(s) with one or more errors:`
    : `Delivered ${calls.length} call(s) successfully:`;

  return [summary, ...outcomes].join('\n');
};