/**
 * /user — Bot-Admin User Ban Management
 *
 * Sub-commands:
 *   /user ban <uid> [reason]   — Ban a platform user from using this bot session
 *   /user unban <uid>          — Lift an existing ban
 *
 * Ban enforcement lives in on-command.middleware.ts (enforceNotBanned) — it checks
 * isUserBanned on every command invocation so banned users are silently blocked
 * without needing any special-casing in individual command modules.
 *
 * Access: role BOT_ADMIN — enforcePermission middleware blocks non-admins before
 * this handler ever executes.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { banUser, unbanUser } from '@/engine/repos/banned.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'user',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description:
    'Manage user bans for this session: ban or unban by platform user ID',
  category: 'Admin',
  usage: '<ban|unban> <uid> [reason]',
  cooldown: 5,
  hasPrefix: true,
  // Exclude Facebook Page since facebook page use PSID (Page-Scoped ID)
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'Action to perform: ban or unban',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'uid',
      description: 'Platform user ID to ban or unban',
      required: false,
    },
  ],
};

export const onCommand = async ({
  chat,
  user,
  args,
  native,
  prefix = '',
}: AppCtx): Promise<void> => {
  const { userId, platform, sessionId } = native;

  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      message: '❌ Cannot resolve session identity.',
      style: MessageStyle.MARKDOWN,
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── /user ban <uid> [reason] ───────────────────────────────────────────────
  if (sub === 'ban') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        message: `❌ Usage: ${prefix}user ban <uid> [reason]`,
        style: MessageStyle.MARKDOWN,
      });
      return;
    }
    const reason = args.slice(2).join(' ') || undefined;
    await banUser(userId, platform, sessionId, uid, reason);
    const userName = await user.getName(uid);
    const reasonSuffix = reason ? ` — Reason: ${reason}` : '';
    await chat.replyMessage({
      message: `🚫 **${userName}** has been banned from this session.${reasonSuffix}`,
      style: MessageStyle.MARKDOWN,
    });
    return;
  }

  // ── /user unban <uid> ──────────────────────────────────────────────────────
  if (sub === 'unban') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        message: `❌ Usage: ${prefix}user unban <uid>`,
        style: MessageStyle.MARKDOWN,
      });
      return;
    }
    await unbanUser(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({
      message: `✅ **${userName}** has been unbanned from this session.`,
      style: MessageStyle.MARKDOWN,
    });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await chat.replyMessage({
    message: [
      'Usage:',
      `  ${prefix}user ban <uid> [reason]  — Ban a user from this session`,
      `  ${prefix}user unban <uid>         — Lift an existing user ban`,
    ].join('\n'),
    style: MessageStyle.MARKDOWN,
  });
};
