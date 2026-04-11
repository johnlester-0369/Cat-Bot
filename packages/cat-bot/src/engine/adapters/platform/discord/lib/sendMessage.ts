/**
 * Sends a text/attachment message via an abstract sendFn.
 * sendFn abstracts the interaction reply vs channel.send difference so both
 * DiscordApi (slash commands) and createDiscordChannelApi (message events)
 * share the same attachment-handling logic.
 */
import { AttachmentBuilder } from 'discord.js';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';
import { streamToBuffer, urlToStream } from '../utils/helper.util.js';

type SendFn = (
  content: string,
  files: AttachmentBuilder[],
) => Promise<{ id: string } | undefined>;

export async function sendMessage(
  sendFn: SendFn,
  msg: string | SendPayload,
): Promise<string | undefined> {
  // Accept both direct string and SendPayload-style object with a `body` field
  const content =
    typeof msg === 'string'
      ? msg
      : (msg.message ?? (msg as unknown as { body?: string }).body ?? '');
  const files: AttachmentBuilder[] = [];

  if (typeof msg !== 'string') {
    // Align with Unified SendPayload contract allowing NamedStreamAttachment[] arrays
    if (msg.attachment) {
      if (Array.isArray(msg.attachment)) {
        for (const { name, stream } of msg.attachment) {
          const buf = Buffer.isBuffer(stream)
            ? stream
            : await streamToBuffer(stream as NodeJS.ReadableStream);
          files.push(new AttachmentBuilder(buf, { name: name || 'file.bin' }));
        }
      } else {
        const stream = msg.attachment;
        const buf = Buffer.isBuffer(stream)
          ? stream
          : await streamToBuffer(stream as NodeJS.ReadableStream);
        files.push(
          new AttachmentBuilder(buf, {
            name: (stream as unknown as { path?: string }).path || 'file.bin',
          }),
        );
      }
    }
    // Support unified NamedUrlAttachment[] arrays identical to replyMessage
    if (msg.attachment_url) {
      for (const { name, url } of msg.attachment_url) {
        const s = await urlToStream(url, name);
        const buf = await streamToBuffer(s);
        files.push(
          new AttachmentBuilder(buf, {
            name:
              name || (s as unknown as { path?: string }).path || 'file.bin',
          }),
        );
      }
    }
  }
  const sent = await sendFn(content, files);
  return sent?.id;
}
