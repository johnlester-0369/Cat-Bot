/**
 * Sends a text/attachment message to a thread via fca-unofficial.
 *
 * Accepts two call signatures:
 *   1. Raw (legacy): msgOrOptions = string | fca-native { body, attachment: ReadableStream }
 *   2. Unified:      msgOrOptions = { message?, attachment?: Array<{name,stream}>, attachment_url?: Array<{name,url}> }
 *
 * The unified path mirrors replyMessage so command modules can use the same
 * { name, stream } / { name, url } attachment objects on both send paths.
 * Buffer inputs are wrapped into a named PassThrough so fca MIME-detection
 * via the .path property derives the correct content type from the extension.
 *
 * Detection heuristic: if msgOrOptions has a 'message' key, an 'attachment_url' key,
 * or attachment is an Array (fca-native attachment is always a single Readable),
 * treat as unified format. Everything else passes through unchanged.
 */

import type { Readable } from 'stream';
import type { SendPayload } from '@/adapters/models/api.model.js';
import { bufferToStream, urlToStream } from '../utils/index.js';

interface FcaMessageInfo {
  messageID?: string;
}

interface FcaApi {
  sendMessage(
    msg: string | object,
    threadID: string,
    cb: (err: unknown, messageInfo: FcaMessageInfo | undefined) => void,
  ): void;
}

export async function sendMessage(
  api: FcaApi,
  msgOrOptions: string | SendPayload,
  threadID: string,
): Promise<string | undefined> {
  // Detect unified format: presence of 'message' key (not fca's 'body'), 'attachment_url' array,
  // or attachment being an Array (fca-native uses a single Readable, never an array)
  const isUnified =
    msgOrOptions !== null &&
    typeof msgOrOptions === 'object' &&
    !Array.isArray(msgOrOptions) &&
    ('message' in msgOrOptions ||
      'attachment_url' in msgOrOptions ||
      Array.isArray((msgOrOptions as SendPayload).attachment));

  if (isUnified) {
    const {
      message = '',
      attachment = [],
      attachment_url = [],
      mentions = [],
    } = msgOrOptions as SendPayload;

    // Download URL attachments first — explicit name controls fca MIME detection via .path
    const urlStreams = await Promise.all(
      (attachment_url ?? []).map(({ name, url }) => urlToStream(url, name)),
    );

    // Normalize each attachment: Buffer inputs are wrapped into a named PassThrough stream so
    // fca derives the correct MIME type from the .path extension (same pattern as replyMessage)
    const attachStreams = (Array.isArray(attachment) ? attachment : []).map(
      ({ name, stream }) => {
        if (Buffer.isBuffer(stream)) return bufferToStream(stream, name);
        (stream as Readable & { path?: string }).path = name;
        return stream as Readable;
      },
    );

    const allStreams = [...attachStreams, ...urlStreams];

    // Map unified {tag, user_id} to fca-unofficial {tag, id} — fca uses 'id' not 'user_id'
    const fcaMentions = (mentions ?? []).map(({ tag, user_id }) => ({
      tag,
      id: user_id,
    }));

    const msg: string | object =
      allStreams.length > 0
        ? {
            body: message,
            attachment: allStreams.length === 1 ? allStreams[0] : allStreams,
            ...(fcaMentions.length ? { mentions: fcaMentions } : {}),
          }
        : // fca requires a named object (not a plain string) when mentions are present, even for text-only sends
          fcaMentions.length
          ? { body: message, mentions: fcaMentions }
          : message || '';

    return new Promise((resolve, reject) => {
      api.sendMessage(msg, threadID, (err, messageInfo) =>
        err ? reject(err) : resolve(messageInfo?.messageID),
      );
    });
  }

  // Fallback: raw string or fca-native { body, attachment: ReadableStream } — pass through unchanged
  return new Promise((resolve, reject) => {
    api.sendMessage(
      msgOrOptions as string | object,
      threadID,
      (err, messageInfo) =>
        err ? reject(err) : resolve(messageInfo?.messageID),
    );
  });
}
