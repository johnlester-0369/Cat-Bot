/**
 * Emoji Mix Maker
 *
 * Combines two emojis into a single blended image using Google's Emoji Kitchen
 * via the Tenor v2 API (media_filter=png_transparent). The result is fetched
 * in-memory and sent as a PNG attachment — no temp files or conversion needed.
 *
 * Sticker note:
 *   The original WhatsApp bot converted the image to WebP with ffmpeg and sent
 *   it as a sticker. Cat-Bot has no documented sticker send type, so the result
 *   is delivered as a regular image attachment instead.
 *
 * Usage:
 *   !emojimix 😎 🥰
 *   !emix 🔥 ❄️
 */
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenorResult {
  url: string;
}

interface TenorResponse {
  results: TenorResult[];
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'emojimix',
  aliases: ['emix'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Combine two emojis into a blended image using Google Emoji Kitchen.',
  category: 'Maker',
  usage: '<emoji1> <emoji2>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  usage,
}: AppCtx): Promise<void> => {
  // Extract any two emoji characters from the full input, regardless of whether
  // the user separates them with a space, a +, or nothing at all.
  const input = args.join(' ');
  const [emoji1, emoji2] = Array.from(
    input.matchAll(/\p{Emoji}/gu),
    (m) => m[0],
  );

  if (!emoji1 || !emoji2) return usage();

  try {
    // ── Step 1: Query Tenor Emoji Kitchen ─────────────────────────────────────
    // Tenor's media_filter=png_transparent returns a direct PNG URL — no
    // ffmpeg conversion or temp files are needed on this side.
    const apiUrl =
      'https://tenor.googleapis.com/v2/featured' +
      '?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ' +
      '&contentfilter=high' +
      '&media_filter=png_transparent' +
      '&component=proactive' +
      '&collection=emoji_kitchen_v5' +
      `&q=${encodeURIComponent(emoji1)}_${encodeURIComponent(emoji2)}`;

    const { data } = await axios.get<TenorResponse>(apiUrl, { timeout: 30000 });

    const imageUrl = data?.results?.[0]?.url;
    if (!imageUrl)
      throw new Error(
        'No image returned. This emoji combination may not be supported.',
      );

    // ── Step 2: Download PNG as in-memory Buffer ───────────────────────────────
    const { data: imgData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const imgBuffer = Buffer.from(imgData);

    // ── Step 3: Send as PNG attachment ────────────────────────────────────────
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `${emoji1} + ${emoji2} **Emoji Mix**`,
      attachment: [{ name: 'emojimix.png', stream: imgBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to mix emojis.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};