/**
 * /car — Random Car Image
 *
 * Calls the PopCat /v2/car endpoint which returns a JSON payload containing
 * an image URL and a title. The image is forwarded via attachment_url so the
 * engine downloads it before sending — no image buffer needed.
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
  name: 'car',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random car image.',
  category: 'fun',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat }: AppCtx): Promise<void> => {
  try {
    const base = createUrl('popcat', '/v2/car');
    if (!base) throw new Error('Failed to build Car API URL.');

    const res = await fetch(base);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const json = await res.json() as {
      error: boolean;
      message: { image: string; title: string };
    };

    if (json.error) throw new Error('API returned an error.');

    const { image, title } = json.message;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🚗 **${title}**`,
      attachment_url: [{ name: 'car.jpg', url: image }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};