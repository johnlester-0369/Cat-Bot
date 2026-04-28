/**
 * Brat Image Generator Command
 *
 * Generates a classic "brat" style image (lime green text on black background)
 * using the free kuroneko (danzy.web.id) API.
 *
 * The API returns the raw image binary directly, so we fetch it as a buffer
 * and send it as an attachment — exactly like the audio preview in the Spotify command.
 *
 * Usage:
 *   !brat hello world
 *   !brat BRAT SUMMER
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'brat',
  aliases: ['bratify', 'bratgen', 'bratmaker'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a Brat-style image with your custom text.',
  category: 'Maker',
  usage: '<text>',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  if (!args.length) return usage();

  const text = args.join(' ');

  // Build the URL using the centralised api.util registry
  // (kuroneko baseURL = https://api.danzy.web.id is already registered)
  const url = createUrl('deline', '/maker/brat', { text });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Brat API request URL.',
    });
    return;
  }

  let imageBuffer: Buffer;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    // The API returns the actual image binary (not JSON)
    const arrayBuffer = await res.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to generate Brat image.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  // Clean filename (max 30 chars to keep it readable)
  const safeText = text.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
  const fileName = `brat-${safeText || 'image'}.png`;

  // Send the image with a nice caption
  await chat.reply({
    style: MessageStyle.MARKDOWN,
    message: `🟩 **Brat** generated:\n**${text}**`,
    attachment: [{ name: fileName, stream: imageBuffer }],
  });
};
