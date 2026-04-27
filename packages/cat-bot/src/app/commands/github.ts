/**
 * /github — GitHub Profile Lookup
 *
 * Fetches a GitHub user's profile from the PopCat /v2/github/:username
 * endpoint and displays it as a formatted card. The avatar is sent as an
 * attachment_url so the engine downloads it before sending.
 *
 * Usage: !github <username>
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
  name: 'github',
  aliases: ['githubstalk', 'ghstalk'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: "Look up a GitHub user's profile.",
  category: 'utility',
  usage: '<username>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
  const username = args[0]?.trim();
  if (!username) return usage();

  try {
    const base = createUrl(
      'popcat',
      `/v2/github/${encodeURIComponent(username)}`,
    );
    if (!base) throw new Error('Failed to build GitHub API URL.');

    const res = await fetch(base);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const json = (await res.json()) as {
      error: boolean;
      message: {
        url: string;
        avatar: string;
        account_type: string;
        name: string;
        company: string;
        blog: string;
        location: string;
        email: string;
        bio: string;
        twitter: string;
        public_repos: string;
        public_gists: string;
        followers: string;
        following: string;
        created_at: string;
        updated_at: string;
      };
    };

    if (json.error) throw new Error('User not found or API returned an error.');

    const m = json.message;
    const joined = new Date(m.created_at).toDateString();

    const lines = [
      `👤 **${m.name}** (${m.account_type})`,
      `🔗 ${m.url}`,
      ``,
      m.bio !== 'No Bio' ? `📝 ${m.bio}` : null,
      m.company !== 'None' ? `🏢 ${m.company}` : null,
      m.location !== 'Not set' ? `📍 ${m.location}` : null,
      m.blog !== 'None' ? `🌐 ${m.blog}` : null,
      m.email !== 'None' ? `📧 ${m.email}` : null,
      m.twitter !== 'Not set' ? `🐦 @${m.twitter}` : null,
      ``,
      `📦 Repos: **${m.public_repos}**  |  📋 Gists: **${m.public_gists}**`,
      `👥 Followers: **${m.followers}**  |  Following: **${m.following}**`,
      `📅 Joined: **${joined}**`,
    ]
      .filter((l) => l !== null)
      .join('\n');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines,
      attachment_url: [{ name: `${m.name}.png`, url: m.avatar }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
