/**
 * /thread — Bot-Admin Thread Ban Management
 *
 * Sub-commands:
 *   /thread ban <tid> [reason]  — Ban a thread from using this bot session
 *   /thread unban <tid>         — Lift an existing thread ban
 *
 * Ban enforcement lives in on-command.middleware.ts (enforceNotBanned) — it checks
 * isThreadBanned on every command invocation so all commands in a banned thread
 * are silently dropped without any special-casing in individual command modules.
 *
 * Access: role BOT_ADMIN — enforcePermission middleware blocks non-admins before
 * this handler ever executes.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { banThread, unbanThread } from '@/engine/repos/banned.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'thread',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description:
    'Manage thread bans for this session: ban or unban by platform thread ID',
  category: 'Admin',
  usage: '<ban|unban> <tid> [reason]',
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
      name: 'tid',
      description: 'Platform thread ID to ban or unban',
      required: false,
    },
  ],
};

export const onCommand = async ({
  chat,
  args,
  native,
  thread,
  prefix = '',
}: AppCtx): Promise<void> => {
  const { userId, platform, sessionId } = native;

  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Cannot resolve session identity.',
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── /thread ban <tid> [reason] ────────────────────────────────────────────
  if (sub === 'ban') {
    const tid = args[1];
    if (!tid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}thread ban <tid> [reason]`,
      });
      return;
    }
    // Remaining args after tid are joined as the reason so multi-word reasons work
    const reason = args.slice(2).join(' ') || undefined;
    await banThread(userId, platform, sessionId, tid, reason);
    const threadName = await thread.getName(tid);
    const reasonSuffix = reason ? ` — Reason: ${reason}` : '';
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🚫 **${threadName}** (\`${tid}\`) has been banned from this session.${reasonSuffix}`,
    });
    return;
  }

  // ── /thread unban <tid> ───────────────────────────────────────────────────
  if (sub === 'unban') {
    const tid = args[1];
    if (!tid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}thread unban <tid>`,
      });
      return;
    }
    await unbanThread(userId, platform, sessionId, tid);
    const threadName = await thread.getName(tid);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${threadName}** (\`${tid}\`) has been unbanned from this session.`,
    });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      'Usage:',
      `  ${prefix}thread ban <tid> [reason]  — Ban a thread from this session`,
      `  ${prefix}thread unban <tid>         — Lift an existing thread ban`,
    ].join('\n'),
  });
};
