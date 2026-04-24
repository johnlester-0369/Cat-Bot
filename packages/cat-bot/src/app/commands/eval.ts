/**
 * Eval Command
 *
 * Executes arbitrary JavaScript code directly in the bot runtime for
 * debugging, inspection, and testing purposes.
 *
 * Security:
 *   Restricted to Role.SYSTEM_ADMIN (level 4) — the highest privilege tier
 *   in Cat-Bot. Only system admins configured globally may invoke this command.
 *   Never lower this role; arbitrary code execution grants full process access.
 *
 * Execution model:
 *   Code is wrapped in an async IIFE so top-level `await` works naturally.
 *   The `ctx` object is injected into the evaluation scope so all Cat-Bot
 *   context (chat, event, native, db, etc.) is accessible from the snippet.
 *
 * Output handling:
 *   - Objects and Maps are JSON-serialised with 2-space indentation.
 *   - Circular references fall back to .toString().
 *   - Results ≤ 3800 chars are edited into the loading message inline.
 *   - Results > 3800 chars are sent as an `eval-output.txt` document to avoid
 *     hitting platform message length limits (Telegram cap: ~4096 chars).
 *
 * Usage:
 *   !eval 1 + 1
 *   !eval ctx.native.platform
 *   !eval await ctx.user.getName(ctx.event['senderID'])
 *   !e Object.keys(ctx)
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Characters at which output is sent as a file instead of an inline edit. */
const INLINE_CHAR_LIMIT = 3800;

// ── Config ────────────────────────────────────────────────────────────────────

export const config = {
  name: 'eval',
  aliases: ['e', 'run'] as string[],
  version: '1.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description:
    'Execute arbitrary JavaScript in the bot runtime. ' +
    'The full AppCtx is available as `ctx`. ' +
    'Top-level `await` is supported. ' +
    'Restricted to System Admins only.',
  category: 'System',
  usage: ['<code>'] as string[],
  cooldown: 0,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts a Map to a plain object for cleaner JSON serialisation. */
function mapToObject(m: Map<unknown, unknown>): Record<string, unknown> {
  return Array.from(m).reduce<Record<string, unknown>>((obj, [key, value]) => {
    obj[String(key)] = value;
    return obj;
  }, {});
}

/**
 * Serialises any value to a human-readable string.
 * Awaits Promises, flattens Maps, JSON-stringifies objects,
 * and falls back to .toString() for circular structures.
 */
async function formatOutput(value: unknown): Promise<string> {
  if (value instanceof Promise) value = await value;

  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  if (typeof value === 'object') {
    if (value instanceof Map)
      value = mapToObject(value as Map<unknown, unknown>);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args, chat, usage } = ctx;

  if (!args.length) return usage();

  const code = args.join(' ');

  // Send a loading placeholder and capture its message ID so we can edit it
  // in-place once execution completes — avoids cluttering the chat with an
  // extra message for every eval.
  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '⚙️ **Compiling...**',
  })) as string | undefined;

  try {
    // Async IIFE wrapper enables top-level `await` in the snippet.
    // `ctx` is passed in so callers can inspect the full AppCtx from the eval.
    // eslint-disable-next-line no-eval
    const result = await eval(`(async (ctx) => { return ${code} })(ctx)`);
    const output = await formatOutput(result);

    if (output.length > INLINE_CHAR_LIMIT) {
      // ── Long output path: send as a plain-text document ───────────────────
      // Unsend the loading placeholder first so it doesn't linger.
      if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

      const buffer = Buffer.from(output, 'utf8');
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '✅ **Output too long** — sent as file.',
        // .txt extension routes to sendDocument on all Cat-Bot platforms.
        attachment: [{ name: 'eval-output.txt', stream: buffer }],
      });
    } else {
      // ── Inline path: edit the loading placeholder with the result ─────────
      const formatted =
        output === 'undefined'
          ? '`undefined`'
          : `\`\`\`json\n${output}\n\`\`\``;

      if (loadingId) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: loadingId,
          message: `✅ **Result:**\n${formatted}`,
        });
      } else {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: `✅ **Result:**\n${formatted}`,
        });
      }
    }
  } catch (err) {
    const error = err as { message?: string; stack?: string };

    if (loadingId) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: loadingId,
        message: `❌ **Runtime Error:**\n\`${error.message ?? String(err)}\``,
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **Runtime Error:**\n\`${error.message ?? String(err)}\``,
      });
    }
  }
};
