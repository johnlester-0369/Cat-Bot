/**
 * Sends a message with optional attachment arrays via the abstract sendFn.
 * reply_to_message_id is forwarded to sendFn — the interaction path silently ignores it
 * (slash command interactions reply via editReply/followUp, not message references),
 * while the channel path creates a Discord quote-thread link.
 */
import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { ButtonItem } from '@/adapters/models/api.model.js';
import { streamToBuffer, urlToStream } from '../utils/helper.util.js';

type SendFn = (
  content: string,
  files: AttachmentBuilder[],
  replyId?: string,
  components?: ActionRowBuilder<ButtonBuilder>[],
) => Promise<string | undefined>;

interface ReplyOptions {
  message?: string;
  attachment?: Array<{ name: string; stream: NodeJS.ReadableStream | Buffer }>;
  attachment_url?: Array<{ name: string; url: string }>;
  reply_to_message_id?: string;
  button?: ButtonItem[];
}

export async function replyMessage(
  sendFn: SendFn,
  {
    message: msgBody = '',
    attachment = [],
    attachment_url = [],
    reply_to_message_id,
    button = [],
  }: ReplyOptions = {},
): Promise<string | undefined> {
  // Accept both direct string and SendPayload-style object with a `body` field
  const content =
    typeof msgBody === 'string'
      ? msgBody
      : ((msgBody as unknown as { body?: string })?.body ?? '');
  const files: AttachmentBuilder[] = [];

  // Destructure {name, stream} — name drives the AttachmentBuilder filename shown in Discord
  for (const { name, stream } of attachment) {
    const buf = Buffer.isBuffer(stream)
      ? stream
      : await streamToBuffer(stream as NodeJS.ReadableStream);
    files.push(new AttachmentBuilder(buf, { name: name || 'file.bin' }));
  }

  // Pass explicit name to urlToStream so Discord displays the caller-specified filename
  for (const { name, url } of attachment_url) {
    const s = await urlToStream(url, name);
    const buf = await streamToBuffer(s);
    files.push(
      new AttachmentBuilder(buf, {
        name: name || (s as unknown as { path?: string }).path || 'file.bin',
      }),
    );
  }

  // Map unified ButtonItem style strings to Discord ButtonStyle enum values.
  // Discord supports up to 5 buttons per ActionRow and 5 rows per message (25 total).
  // We batch into rows of 5 — the common case is ≤5 buttons in a single row.
  const STYLE_MAP: Record<string, ButtonStyle> = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
  };
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (button.length > 0) {
    for (let i = 0; i < button.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const btn of button.slice(i, i + 5)) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(btn.id)
            .setLabel(btn.label)
            .setStyle(
              STYLE_MAP[btn.style ?? 'secondary'] ?? ButtonStyle.Secondary,
            ),
        );
      }
      components.push(row);
    }
  }

  return sendFn(content, files, reply_to_message_id, components);
}
