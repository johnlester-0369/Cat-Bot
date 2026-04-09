/**
 * Sends a message with optional attachment arrays and optional reply threading.
 * Accepts Readable streams (attachment[]) and static URLs (attachment_url[]).
 * fca-unofficial sendMessage accepts { body, attachment } where attachment may be
 * a single stream or an array — all items upload in one Graph API call.
 */

import type { Readable } from 'stream';
import { bufferToStream, urlToStream } from '../utils/index.js';

import type { ReplyMessageOptions } from '@/engine/adapters/models/api.model.js';

/** fca sendMessage callback message info shape. */
interface FcaMessageInfo {
  messageID?: string;
}

interface FcaApi {
  sendMessage(
    msg: string | object,
    threadID: string,
    cb: (err: unknown, data: FcaMessageInfo | undefined) => void,
    replyToMessageID?: string,
  ): void;
}

export async function replyMessage(
  api: FcaApi,
  threadID: string,
  options: ReplyMessageOptions = {},
): Promise<string | undefined> {
  let message = '';
  if (typeof options.message === 'string') {
    message = options.message;
  } else if (options.message && typeof options.message === 'object') {
    // Support unified SendPayload objects if explicitly forwarded without ChatContext flattening
    message = options.message.message ?? options.message.body ?? '';
  }

  const attachment = options.attachment ?? [];
  const attachment_url = options.attachment_url ?? [];
  const reply_to_message_id = options.reply_to_message_id;
  const mentions = options.mentions ?? [];

  // Download URL attachments first — explicit name controls fca MIME detection via .path
  const urlStreams = await Promise.all(
    (attachment_url ?? []).map(({ name, url }) => urlToStream(url, name)),
  );

  // Normalize each attachment: Buffer inputs are wrapped into a named PassThrough stream so
  // fca derives the correct MIME type from the .path extension — callers need not call
  // bufferToStream manually; replyMessage handles it transparently
  const attachStreams = (attachment ?? []).map(({ name, stream }) => {
    if (Buffer.isBuffer(stream)) return bufferToStream(stream, name);
    (stream as Readable & { path?: string }).path = name;
    return stream as Readable;
  });

  const allStreams = [...attachStreams, ...urlStreams];

  // Map unified {tag, user_id} to fca-unofficial {tag, id} — fca's sendMessage contract uses 'id'
  const fcaMentions = mentions.map(({ tag, user_id }) => ({
    tag,
    id: user_id,
  }));

  // fca sendMessage({ body, attachment, mentions }) — attachment is a single stream or an array of streams
  const msg: string | object =
    allStreams.length > 0
      ? {
          body: message,
          attachment: allStreams.length === 1 ? allStreams[0] : allStreams,
          ...(fcaMentions.length ? { mentions: fcaMentions } : {}),
        }
      : // fca requires an object (not a plain string) when mentions are present, even for text-only replies
        fcaMentions.length
        ? { body: message, mentions: fcaMentions }
        : message || '';

  return new Promise((resolve, reject) => {
    api.sendMessage(
      msg,
      threadID,
      (err, data) => (err ? reject(err) : resolve(data?.messageID)),
      reply_to_message_id,
    );
  });
}
