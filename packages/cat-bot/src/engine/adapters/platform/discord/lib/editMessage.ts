/**
 * Edits the body of a bot-sent Discord message.
 * Only the bot's own messages are editable — attempting to edit another user's
 * message will throw a DiscordAPIError with code 50005.
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  type MessageEditOptions,
  type TextChannel,
} from 'discord.js';
import type { EditMessageOptions } from '@/engine/adapters/models/api.model.js';
import { streamToBuffer, urlToStream } from '../utils/helper.util.js';

export async function editMessage(
  channel: TextChannel,
  messageID: string,
  options: string | EditMessageOptions,
): Promise<void> {
  if (!channel) throw new Error('Channel not available for editing.');
  // No direct channel.editMessage() in discord.js — must fetch the Message object first
  const msg = await channel.messages.fetch(messageID);

  // Safely extract the text string from both string and unified SendPayload shapes —
  // SendPayload.message may itself be a nested object when callers forward raw payloads.
  let content: string;
  if (typeof options === 'string') {
    content = options;
  } else {
    const rawMsg = options.message;
    content =
      typeof rawMsg === 'string'
        ? rawMsg
        : ((rawMsg as { message?: string } | undefined)?.message ??
          (rawMsg as { body?: string } | undefined)?.body ??
          '');
  }

  const style = typeof options === 'object' ? options.style : undefined;
  const finalContent = style === 'text' ? escapeMarkdown(content) : content;

  // Use discord.js MessageEditOptions for type-safe payload construction —
  // replaces the previous Record<string,unknown> cast to Parameters<typeof msg.edit>[0]
  // which silently bypassed TypeScript's structural checks on the discord.js API surface.
  const payload: MessageEditOptions = { content: finalContent };
  const button = typeof options === 'object' ? options.button : undefined;

  // Process attachment arrays into AttachmentBuilder objects — mirrors replyMessage.ts processing.
  // Discord API v10: when `files` are supplied, all retained attachments are kept by default
  // (no explicit `attachments: []` needed unless the caller wants to remove existing files).
  const attachment =
    typeof options === 'object' ? options.attachment : undefined;
  const attachmentUrl =
    typeof options === 'object' ? options.attachment_url : undefined;
  const files: AttachmentBuilder[] = [];
  if (attachment?.length) {
    for (const { name, stream } of attachment) {
      const buf = Buffer.isBuffer(stream)
        ? stream
        : await streamToBuffer(stream as NodeJS.ReadableStream);
      files.push(new AttachmentBuilder(buf, { name: name || 'file.bin' }));
    }
  }
  if (attachmentUrl?.length) {
    for (const { name, url } of attachmentUrl) {
      const s = await urlToStream(url, name);
      const buf = await streamToBuffer(s);
      files.push(
        new AttachmentBuilder(buf, {
          name: name || (s as unknown as { path?: string }).path || 'file.bin',
        }),
      );
    }
  }
  if (files.length > 0) payload.files = files;

  // Convert Unified ButtonItems into Discord ActionRowBuilders.
  // Explicit undefined check (not truthiness) so an empty array [] correctly clears
  // all components — `if ([])` is truthy but the intent is "caller provided buttons".
  if (button !== undefined) {
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (button.length > 0) {
      const STYLE_MAP: Record<string, ButtonStyle> = {
        primary: ButtonStyle.Primary,
        secondary: ButtonStyle.Secondary,
        success: ButtonStyle.Success,
        danger: ButtonStyle.Danger,
      };
      // Each inner array is one ActionRow — matches the 2-D ButtonItem[][] contract from EditMessageOptions.
      // Preserves the caller's explicit row grouping so grids and mixed layouts survive edits unchanged.
      for (const rowItems of button) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (const btn of rowItems) {
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
    payload.components = components;
  }

  await msg.edit(payload);
}
