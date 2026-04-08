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

import type { ChatContext } from '@/engine/adapters/models/context.model.js';
import type { NativeContext } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { banThread, unbanThread } from '@/engine/repos/banned.repo.js';
import { OptionType } from '@/engine/constants/command-option.constants.js';

export const config = {
  name: 'thread',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description: 'Manage thread bans for this session: ban or unban by platform thread ID',
  category: 'Admin',
  usage: '<ban|unban> <tid> [reason]',
  cooldown: 5,
  hasPrefix: true,
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
}: {
  chat: ChatContext;
  args: string[];
  native: NativeContext;
}): Promise<void> => {
  const { userId, platform, sessionId } = native;

  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({ message: '❌ Cannot resolve session identity.' });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── /thread ban <tid> [reason] ────────────────────────────────────────────
  if (sub === 'ban') {
    const tid = args[1];
    if (!tid) {
      await chat.replyMessage({ message: '❌ Usage: /thread ban <tid> [reason]' });
      return;
    }
    // Remaining args after tid are joined as the reason so multi-word reasons work
    const reason = args.slice(2).join(' ') || undefined;
    await banThread(userId, platform, sessionId, tid, reason);
    const reasonSuffix = reason ? ` — Reason: ${reason}` : '';
    await chat.replyMessage({ message: `🚫 Thread ${tid} has been banned from this session.${reasonSuffix}` });
    return;
  }

  // ── /thread unban <tid> ───────────────────────────────────────────────────
  if (sub === 'unban') {
    const tid = args[1];
    if (!tid) {
      await chat.replyMessage({ message: '❌ Usage: /thread unban <tid>' });
      return;
    }
    await unbanThread(userId, platform, sessionId, tid);
    await chat.replyMessage({ message: `✅ Thread ${tid} has been unbanned from this session.` });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await chat.replyMessage({
    message: [
      'Usage:',
      '  /thread ban <tid> [reason]  — Ban a thread from this session',
      '  /thread unban <tid>         — Lift an existing thread ban',
    ].join('\n'),
  });
};
