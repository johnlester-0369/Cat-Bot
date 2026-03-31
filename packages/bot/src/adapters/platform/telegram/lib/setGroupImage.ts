/**
 * Telegram — setGroupImage
 *
 * setChatPhoto requires a multipart/form-data upload — the Bot API does NOT
 * accept remote URL strings the way sendPhoto does server-side. For URL inputs,
 * axios downloads to a Buffer first, then Input.fromBuffer uploads it cleanly.
 * Input.fromURLStream returns a ClientRequest (Writable), not a Readable —
 * Telegraf's multipart uploader throws TypeError when piping from it, making
 * the axios download path mandatory for URLs.
 *
 * ctx.setChatPhoto() reads chat.id internally via Telegraf context.ts:536,
 * eliminating the chat?.id optional-chain risk.
 */
import type { Readable } from 'stream';
import type { Context } from 'telegraf';
import { Input } from 'telegraf';
import axios from 'axios';

export async function setGroupImage(
  ctx: Context,
  _threadID: string,
  imageSource: Buffer | Readable | string,
): Promise<void> {
  let photo:
    | ReturnType<typeof Input.fromBuffer>
    | ReturnType<typeof Input.fromReadableStream>;

  if (typeof imageSource === 'string') {
    // setChatPhoto rejects remote URLs — download via axios then upload as Buffer
    const res = await axios.get<ArrayBuffer>(imageSource, {
      responseType: 'arraybuffer',
      timeout: 15_000,
    });
    photo = Input.fromBuffer(Buffer.from(res.data), 'photo.jpg');
  } else if (Buffer.isBuffer(imageSource)) {
    photo = Input.fromBuffer(imageSource, 'photo.jpg');
  } else {
    // Readable stream path for callers that already have a stream
    photo = Input.fromReadableStream(imageSource, 'photo.jpg');
  }

  await ctx.setChatPhoto(photo);
}
