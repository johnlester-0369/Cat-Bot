/**
 * /subreddit — Subreddit Info Lookup
 *
 * Fetches subreddit information from the PopCat /v2/subreddit/:name endpoint
 * and displays it as a formatted card. The community icon is sent as an
 * attachment_url so the engine downloads it before sending.
 *
 * Usage: !subreddit <name>   (without r/)
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
  name: 'subreddit',
  aliases: ['reddit'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Look up info about a subreddit.',
  category: 'utility',
  usage: '<subreddit name>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
  const name = args[0]?.replace(/^r\//i, '').trim();
  if (!name) return usage();

  try {
    const base = createUrl(
      'popcat',
      `/v2/subreddit/${encodeURIComponent(name)}`,
    );
    if (!base) throw new Error('Failed to build Subreddit API URL.');

    const res = await fetch(base);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const json = (await res.json()) as {
      error: boolean;
      message: {
        name: string;
        title: string;
        active_users: number;
        members: string;
        description: string;
        icon: string;
        banner: string;
        allow_videos: boolean;
        allow_images: boolean;
        over_18: boolean;
        url: string;
      };
    };

    if (json.error)
      throw new Error('Subreddit not found or API returned an error.');

    const m = json.message;

    const lines = [
      `📌 **r/${m.name}**`,
      `_${m.title}_`,
      ``,
      m.description ? `📝 ${m.description}` : null,
      ``,
      `👥 Members: **${m.members}**`,
      `🟢 Active Users: **${m.active_users.toLocaleString()}**`,
      `🎬 Videos: **${m.allow_videos ? 'Yes' : 'No'}**  |  🖼️ Images: **${m.allow_images ? 'Yes' : 'No'}**`,
      m.over_18 ? `🔞 **NSFW Community**` : null,
      `🔗 ${m.url}`,
    ]
      .filter((l) => l !== null)
      .join('\n');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines,
      attachment_url: [{ name: `${m.name}.png`, url: m.icon }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
