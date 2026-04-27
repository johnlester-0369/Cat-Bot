/**
 * /steam — Steam Game Lookup
 *
 * Searches for a game on Steam via the PopCat /v2/steam endpoint and
 * displays its details. The game banner is sent as an attachment_url so
 * the engine downloads it before sending.
 *
 * Usage: !steam <game name>
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
  name: 'steam',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Look up a game on Steam.',
  category: 'utility',
  usage: '<game name>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
  const query = args.join(' ').trim();
  if (!query) return usage();

  try {
    const base = createUrl('popcat', '/v2/steam');
    if (!base) throw new Error('Failed to build Steam API URL.');

    const apiUrl = `${base}?q=${encodeURIComponent(query)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const json = (await res.json()) as {
      error: boolean;
      message: {
        type: string;
        name: string;
        thumbnail: string;
        controller_support: string;
        description: string;
        website: string;
        banner: string;
        developers: string[];
        publishers: string[];
        price: string;
      };
    };

    if (json.error) throw new Error('Game not found or API returned an error.');

    const m = json.message;

    const lines = [
      `🎮 **${m.name}** _(${m.type})_`,
      ``,
      `📝 ${m.description}`,
      ``,
      `💰 Price: **${m.price}**`,
      `🕹️ Controller: **${m.controller_support}**`,
      `👨‍💻 Developer: **${m.developers.join(', ')}**`,
      `📦 Publisher: **${m.publishers.join(', ')}**`,
      m.website ? `🌐 ${m.website}` : null,
    ]
      .filter((l) => l !== null)
      .join('\n');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines,
      attachment_url: [{ name: `${m.name}.jpg`, url: m.banner }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
