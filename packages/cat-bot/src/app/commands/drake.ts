/**
 * /drake — Drake Meme Generator
 *
 * Accepts two text prompts separated by a pipe ( | ) and passes them to the
 * PopCat /v2/drake endpoint as text1 and text2. The API returns an image
 * which is sent as a Buffer attachment.
 *
 * Usage: !drake <top text> | <bottom text>
 *
 * ⚠️  `createUrl` registry name 'popcat' is assumed — confirm with the
 *     Cat Bot engine team that this registry key exists.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'drake',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a Drake meme with two prompts.',
  category: 'fun',
  usage: '<top text> | <bottom text>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
  const parts = args
    .join(' ')
    .split('|')
    .map((s) => s.trim());
  const text1 = parts[0] ?? '';
  const text2 = parts[1] ?? '';

  if (!text1 || !text2) return usage();

  try {
    const base = createUrl('popcat', '/v2/drake');
    if (!base) throw new Error('Failed to build Drake API URL.');

    const params = new URLSearchParams({ text1, text2 });
    const apiUrl = `${base}?${params.toString()}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const imageBuffer = Buffer.from(await res.arrayBuffer());

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🎤 **Drake Meme**',
      attachment: [{ name: 'drake.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
