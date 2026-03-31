/**
 * Telegram — replyMessage
 *
 * Routes attachments to the correct Bot API method by .path extension:
 *   photos → sendMediaGroup (single album call, up to 10)
 *   gifs   → sendAnimation (sendMediaGroup cannot mix animation + photo types)
 *   audio  → sendVoice (sequential; no sendVoiceGroup in Bot API)
 *   others → sendDocument
 *
 * reply_to_message_id wires reply_parameters so Telegram threads the message
 * to the original. Caption appears on the first photo of a media group only —
 * Telegram displays one caption per group.
 */
import type { Context } from 'telegraf';
import type { Readable } from 'stream';
import { Input } from 'telegraf';
import type { MessageEntity } from 'telegraf/types';
import {
  bufferToStream,
  streamToBuffer,
  urlToStream,
} from '@/utils/streams.util.js';
// text_mention entities allow tagging users by numeric ID without a public @username — Bot API 7.0+
import { buildTelegramMentionEntities } from '../utils/helper.util.js';
import type {
  ButtonItem,
  MentionEntry,
  NamedStreamAttachment,
  NamedUrlAttachment,
} from '@/adapters/models/api.model.js';

interface ReplyOpts {
  message?: string | { body?: string };
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  reply_to_message_id?: string | number;
  button?: ButtonItem[];
  mentions?: MentionEntry[];
}

// Augment Readable to carry a path property for extension-based routing
interface AttachmentStream extends Readable {
  path?: string;
}

export async function replyMessage(
  ctx: Context,
  _threadID: string,
  {
    message: msgBody = '',
    attachment = [],
    attachment_url = [],
    reply_to_message_id,
    button = [],
    mentions = [],
  }: ReplyOpts = {},
): Promise<string | undefined> {
  const chatId = ctx.chat?.id as number;
  const text =
    typeof msgBody === 'string'
      ? msgBody
      : ((msgBody as { body?: string })?.body ?? '');

  // Compute text_mention entities once for all send calls in this invocation
  const entities = buildTelegramMentionEntities(text, mentions);
  // textExtra: 'entities' field used by sendMessage (plain text messages)
  // captionExtra: 'caption_entities' field used by media methods
  // Telegram distinguishes these two fields — using 'entities' on a media method silently ignores the value
  const replyExtra = reply_to_message_id
    ? { reply_parameters: { message_id: Number(reply_to_message_id) } }
    : {};
  const textExtra = { ...replyExtra, ...(entities.length ? { entities } : {}) };
  const captionExtra = {
    ...replyExtra,
    ...(entities.length
      ? { caption_entities: entities as MessageEntity[] }
      : {}),
  };

  // Build Telegram InlineKeyboardMarkup when buttons are requested.
  // Telegram callback_data is capped at 64 bytes — the "commandName:actionId" format
  // is compact, but we slice defensively to avoid the Bot API rejecting longer IDs.
  const replyMarkup =
    button.length > 0
      ? {
          inline_keyboard: [
            button.map((btn) => ({
              text: btn.label,
              callback_data: btn.id.slice(0, 64),
            })),
          ],
        }
      : undefined;

  // Pass explicit name to urlToStream so extOf() extension routing uses the caller-specified filename
  const urlStreams = await Promise.all(
    attachment_url.map(({ name, url }) => urlToStream(url, name)),
  );
  // Normalize each attachment: Buffer inputs are wrapped into a named PassThrough stream so
  // extOf() can route by extension and streamToBuffer() receives a proper Readable
  const attachStreams: AttachmentStream[] = attachment.map(
    ({ name, stream }) => {
      if (Buffer.isBuffer(stream))
        return bufferToStream(stream, name) as AttachmentStream;
      const s = stream as AttachmentStream;
      s.path = name;
      return s;
    },
  );
  const allAttachments: AttachmentStream[] = [
    ...attachStreams,
    ...(urlStreams as AttachmentStream[]),
  ];

  if (allAttachments.length === 0) {
    const sent = await ctx.telegram.sendMessage(chatId, text || ' ', {
      ...textExtra,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return String(sent.message_id);
  }

  const extOf = (s: AttachmentStream): string =>
    (s.path ?? '').split('.').pop()?.toLowerCase() ?? '';

  const photos = allAttachments.filter((s) =>
    ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(extOf(s)),
  );
  const gifs = allAttachments.filter((s) => extOf(s) === 'gif');
  const audios = allAttachments.filter((s) =>
    ['mp3', 'ogg', 'wav', 'aac', 'opus', 'm4a'].includes(extOf(s)),
  );
  const others = allAttachments.filter(
    (s) => !photos.includes(s) && !gifs.includes(s) && !audios.includes(s),
  );

  // Batch photos into one album — caption on first item only
  if (photos.length > 0) {
    await ctx.telegram.sendMediaGroup(
      chatId,
      await Promise.all(
        photos.map(async (s, idx) => ({
          type: 'photo' as const,
          media: Input.fromBuffer(
            await streamToBuffer(s),
            s.path || `photo_${idx}.jpg`,
          ),
          // caption_entities on the first item applies the mention highlights to the album caption
          ...(idx === 0 && text
            ? {
                caption: text,
                ...(entities.length
                  ? { caption_entities: entities as MessageEntity[] }
                  : {}),
              }
            : {}),
        })),
      ),
      captionExtra,
    );
  }

  for (const gif of gifs) {
    await ctx.telegram.sendAnimation(
      chatId,
      Input.fromBuffer(await streamToBuffer(gif), gif.path || 'animation.gif'),
      gifs.indexOf(gif) === 0 && photos.length === 0 && text
        ? { caption: text, ...captionExtra }
        : captionExtra,
    );
  }

  for (const audio of audios) {
    await ctx.telegram.sendVoice(
      chatId,
      Input.fromBuffer(await streamToBuffer(audio), audio.path || 'audio.mp3'),
      captionExtra,
    );
  }

  for (const doc of others) {
    await ctx.telegram.sendDocument(
      chatId,
      Input.fromBuffer(await streamToBuffer(doc), doc.path || 'document.bin'),
      { caption: text, ...captionExtra },
    );
  }

  // sendMediaGroup does not support reply_markup — send a separate message with
  // the button keyboard appended after the media so both are visible in sequence.
  if (replyMarkup) {
    const sent = await ctx.telegram.sendMessage(chatId, text || '\u200b', {
      ...replyExtra,
      reply_markup: replyMarkup,
    });
    return String(sent.message_id);
  }

  return undefined;
}
