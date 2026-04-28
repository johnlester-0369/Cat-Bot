/**
 * Brat Anime Image Generator Command
 *
 * Generates a "Brat Anime" style image (anime version of the classic lime-green Brat meme)
 * using the free NexRay API. The API returns the raw image binary directly.
 *
 * Usage:
 *   !bratanime Yo
 *   !bratanime BRAT SUMMER
 *   !bratanime anime girl
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'bratanime',
  aliases: ['animebrat', 'bratanimegen'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Generate a Brat Anime style image with your custom text (anime version of the classic Brat meme).',
  category: 'Anime',
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
  // (nexray baseURL = https://api.nexray.web.id is already registered)
  const url = createUrl('nexray', '/maker/bratanime', { text });
  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to build the Brat Anime API request URL.',
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
      message: `❌ Failed to generate Brat Anime image.\n\`${error.message ?? 'Unknown error'}\``,
    });
    return;
  }

  // Clean filename
  const safeText = text.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
  const fileName = `bratanime-${safeText || 'image'}.png`;

  // Send the image with a nice caption
  await chat.reply({
    style: MessageStyle.MARKDOWN,
    message: `🟩 **Brat Anime** generated:\n**${text}**`,
    attachment: [{ name: fileName, stream: imageBuffer }],
  });
};
