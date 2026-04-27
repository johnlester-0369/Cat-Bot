/**
 * /caution — Caution Sign Generator
 *
 * Accepts a text prompt from args and passes it to the PopCat /v2/caution
 * endpoint. The API returns an image which is sent as a Buffer attachment.
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
  name: 'caution',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a caution sign with your text.',
  category: 'fun',
  usage: '<text>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
  const text = args.join(' ').trim();
  if (!text) return usage();

  try {
    const base = createUrl('popcat', '/v2/caution');
    if (!base) throw new Error('Failed to build Caution API URL.');

    const apiUrl = `${base}?text=${encodeURIComponent(text)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const imageBuffer = Buffer.from(await res.arrayBuffer());

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⚠️ **Caution!**',
      attachment: [{ name: 'caution.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
