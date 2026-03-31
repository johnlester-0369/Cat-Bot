/**
 * Sends a text/attachment message via an abstract sendFn.
 * sendFn abstracts the interaction reply vs channel.send difference so both
 * DiscordApi (slash commands) and createDiscordChannelApi (message events)
 * share the same attachment-handling logic.
 */
import { AttachmentBuilder } from 'discord.js';
import type { SendPayload } from '@/adapters/models/api.model.js';
import { streamToBuffer } from '../utils/helper.util.js';

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
      : ((msg as unknown as { body?: string }).body ?? '');
  const files: AttachmentBuilder[] = [];

  if (typeof msg !== 'string' && msg.attachment) {
    const stream = msg.attachment;
    // Streams from fca-style code may arrive here; AttachmentBuilder requires Buffer or URL
    const buf = await streamToBuffer(stream as NodeJS.ReadableStream);
    files.push(
      new AttachmentBuilder(buf, {
        name: (stream as unknown as { path?: string }).path || 'file.bin',
      }),
    );
  }
  const sent = await sendFn(content, files);
  return sent?.id;
}
