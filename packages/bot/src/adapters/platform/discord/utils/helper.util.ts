/**
 * Discord Platform — Shared Utilities
 *
 * General-purpose helpers used by the wrapper layer:
 *   - streamToBuffer: async iteration collector for Discord.js streams
 *   - urlToStream: re-exported from the shared streams module
 *   - buildDiscordMentionMsg: replaces @tag placeholders with <@userId> format
 *
 * WHY: Event normalizers were extracted to utils/normalizers.util.ts — this file
 * now contains only stream and text-transform utilities, which are distinct concerns
 * from event shape normalization.
 */

import type { SendPayload } from '@/adapters/models/api.model.js';

// Re-export shared stream utility so lib/ files have a single local source
export { urlToStream } from '@/utils/streams.util.js';

/**
 * Collects all chunks from a stream via async iteration.
 * Preferred over EventEmitter (.on 'data') for Discord.js streams which may be async-iterables.
 */
export async function streamToBuffer(
  stream: NodeJS.ReadableStream | AsyncIterable<Buffer>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// ── Mention text builder ──────────────────────────────────────────────────────

/**
 * Replaces @tag placeholders in a message body with Discord's native <@userId> mention format.
 * Discord renders <@userId> as a highlighted clickable name and dispatches a notification.
 * Accepts both the raw string form and the unified SendPayload object so callers can pass the
 * msg argument from sendMessage/replyMessage directly without inspecting its shape first.
 *
 * split+join is used instead of replace/replaceAll to avoid RegExp escaping edge cases with
 * special characters in tag strings (e.g. '@user[1]').
 */
export function buildDiscordMentionMsg(
  msg: string | SendPayload,
): string | SendPayload {
  if (
    !msg ||
    !Array.isArray((msg as SendPayload).mentions) ||
    (msg as SendPayload).mentions!.length === 0
  )
    return msg;
  const payload = msg as SendPayload;
  let text =
    payload.message ?? (payload as unknown as { body?: string }).body ?? '';
  for (const { tag, user_id } of payload.mentions!) {
    // <@userId> is Discord's user mention format — renders as a highlighted, clickable name
    text = text.split(tag).join(`<@${user_id}>`);
  }
  // Rebuild without the mentions array — user IDs are now embedded in the text
  // Use computed spread to avoid unused-variable lint errors from named destructuring
  const rest = Object.fromEntries(
    Object.entries(payload).filter(([k]) => k !== 'mentions'),
  ) as Omit<SendPayload, 'mentions'>;
  if (payload.message !== undefined)
    (rest as Record<string, unknown>)['message'] = text;
  if ((payload as Record<string, unknown>)['body'] !== undefined)
    (rest as Record<string, unknown>)['body'] = text;
  return rest as SendPayload;
}
