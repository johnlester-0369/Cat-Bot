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
} from '@/engine/utils/streams.util.js';
// text_mention entities allow tagging users by numeric ID without a public @username — Bot API 7.0+
import { buildTelegramMentionEntities } from '../utils/helper.util.js';
import { sanitizeMarkdownV2 } from '../utils/markdownv2.util.js';
import type { ReplyMessageOptions } from '@/engine/adapters/models/api.model.js';

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
    style,
  }: ReplyMessageOptions = {},
): Promise<string | undefined> {
  // Use the explicit _threadID when it resolves to a non-zero number so the bot
  // can send to a different chat (admin DM, support group) than the one that
  // triggered the current update.  Falls back to ctx.chat?.id for the standard
  // same-chat reply path.
  const chatId = Number(_threadID) || (ctx.chat?.id as number);
  // `let` — sanitizeMarkdownV2 may reassign; avoids scattering a safeText alias through all send paths
  let text =
    typeof msgBody === 'string'
      ? msgBody
      : // Fallback matches SendPayload explicitly to prevent dropping `message` vs `body` payloads
        ((msgBody as { message?: string })?.message ??
        (msgBody as { body?: string })?.body ??
        '');

  // Hoist parseMode before entities — entity byte-offsets must be computed against the final
  // string Telegram actually receives, so sanitisation must happen first.
  // Legacy 'Markdown' mode is intentionally not used — Telegram officially deprecated it.
  const parseMode = style === 'markdown' ? ('MarkdownV2' as const) : undefined;

  // Escape bare MarkdownV2 reserved characters before computing mention entity offsets.
  // The 18 reserved chars (_ * [ ] ( ) ~ ` > # + - = | { } . !) cause 400 Bot API errors
  // when unescaped. sanitizeMarkdownV2 skips chars already preceded by '\' (valid escape
  // sequences), so intentional formatting like *bold* and _italic_ is preserved.
  // Mutation here means all downstream send paths (sendMessage, sendMediaGroup captions,
  // sendDocument, the button keyboard message) automatically use the corrected string
  // without per-call guards, and text_mention entities align with what Telegram parses.
  // Always sanitize — sanitizeMarkdownV2 is idempotent, so running on already-valid
  // text is a no-op. This avoids the double-call from the old validate-then-sanitize gate.
  if (parseMode === 'MarkdownV2') text = sanitizeMarkdownV2(text);

  // Compute text_mention entities once for all send calls in this invocation.
  // Entities are computed against `text` AFTER sanitisation so byte-offsets align with
  // what Telegram receives — inserting '\' shifts positions and would misplace highlights.
  // textExtra uses 'entities'; captionExtra uses 'caption_entities' — Telegram distinguishes
  // these two fields and silently ignores 'entities' on media (sendMediaGroup, sendDocument).
  const entities = buildTelegramMentionEntities(text, mentions);
  const replyExtra = reply_to_message_id
    ? { reply_parameters: { message_id: Number(reply_to_message_id) } }
    : {};
  const textExtra = {
    ...replyExtra,
    ...(entities.length ? { entities } : {}),
    ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
  };
  const captionExtra = {
    ...replyExtra,
    ...(entities.length
      ? { caption_entities: entities as MessageEntity[] }
      : {}),
    ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
  };

  // Build Telegram InlineKeyboardMarkup when buttons are requested.
  // Telegram callback_data is capped at 64 bytes — the "commandName:buttonId" format
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

  // Single photo + buttons: sendPhoto supports reply_markup natively; sendMediaGroup never
  // does — the Bot API simply ignores the field, causing the fallback block below to fire
  // and produce a SECOND message containing only the buttons. Routing the single-photo+button
  // case through sendPhoto collapses both into one message.
  if (photos.length === 1 && replyMarkup) {
    const sp = photos[0]!;
    const sent = await ctx.telegram.sendPhoto(
      chatId,
      Input.fromBuffer(await streamToBuffer(sp), sp.path || 'photo.jpg'),
      {
        ...(text ? { caption: text } : {}),
        ...captionExtra,
        reply_markup: replyMarkup,
      },
    );
    return String(sent.message_id);
  }
  // Batch multiple photos into one album — caption on first item only
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
          // caption_entities and parse_mode on the first item apply to the album caption only;
          // subsequent items in the group intentionally omit them (Telegram Bot API limitation)
          ...(idx === 0 && text
            ? {
                caption: text,
                ...(entities.length
                  ? { caption_entities: entities as MessageEntity[] }
                  : {}),
                ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
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
      ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
      reply_markup: replyMarkup,
    });
    return String(sent.message_id);
  }

  return undefined;
}
