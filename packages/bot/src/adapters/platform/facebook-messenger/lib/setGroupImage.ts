/**
 * Facebook Messenger — setGroupImage
 *
 * Delegates to fca-unofficial api.changeGroupImage(image, threadID, callback).
 *
 * The fca-unofficial changeGroupImage API requires a Readable stream whose .path
 * property carries the filename so the Graph API upload derives the correct MIME type.
 *
 * Three source types are accepted to match the unified setGroupImage contract:
 *   Buffer  → bufferToStream (attaches .path so fca reads the extension for MIME)
 *   string  → urlToStream (downloads via axios; .path set from URL tail or override)
 *   Readable → used directly — caller is responsible for a named .path when needed
 */

import type { Readable } from 'stream';
import { bufferToStream, urlToStream } from '../utils/index.js';

interface FcaApi {
  changeGroupImage(
    stream: Readable,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
}

export async function setGroupImage(
  api: FcaApi,
  threadID: string,
  imageSource: Buffer | Readable | string,
): Promise<void> {
  let stream: Readable;

  if (typeof imageSource === 'string') {
    // URL path — urlToStream downloads via axios and sets .path from the URL tail
    // so fca-unofficial derives the correct MIME type from the file extension
    stream = await urlToStream(imageSource, `group_${Date.now()}.jpg`);
  } else if (Buffer.isBuffer(imageSource)) {
    // Buffer path — bufferToStream wraps in a PassThrough and sets .path so fca
    // can detect the MIME type from the extension before uploading to Graph API
    stream = bufferToStream(imageSource, `group_${Date.now()}.jpg`);
  } else {
    // Readable path — passed directly; caller should set stream.path if MIME detection is needed
    stream = imageSource;
  }

  return new Promise((resolve, reject) => {
    api.changeGroupImage(stream, threadID, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
