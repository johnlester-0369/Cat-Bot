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
import { OptionType } from '@/engine/constants/command-option.constants.js';

export const config = {
  name: 'user',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description: 'Manage user bans for this session: ban or unban by platform user ID',
  category: 'Admin',
  usage: '<ban|unban> <uid> [reason]',
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
}: AppCtx): Promise<void> => {
  const { userId, platform, sessionId } = native;

  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({ message: '❌ Cannot resolve session identity.' });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── /user ban <uid> [reason] ───────────────────────────────────────────────
  if (sub === 'ban') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({ message: '❌ Usage: /user ban <uid> [reason]' });
      return;
    }
    // Remaining args after uid are joined as the reason so multi-word reasons work
    const reason = args.slice(2).join(' ') || undefined;
    await banUser(userId, platform, sessionId, uid, reason);
    const userName = await user.getName(uid);
    const reasonSuffix = reason ? ` — Reason: ${reason}` : '';
    await chat.replyMessage({ message: `🚫 ${userName} has been banned from this session.${reasonSuffix}` });
    return;
  }

  // ── /user unban <uid> ──────────────────────────────────────────────────────
  if (sub === 'unban') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({ message: '❌ Usage: /user unban <uid>' });
      return;
    }
    await unbanUser(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({ message: `✅ ${userName} has been unbanned from this session.` });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await chat.replyMessage({
    message: [
      'Usage:',
      '  /user ban <uid> [reason]  — Ban a user from this session',
      '  /user unban <uid>         — Lift an existing user ban',
    ].join('\n'),
  });
};
