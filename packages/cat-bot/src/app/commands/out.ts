/**
 * /out — Bot Self-Eject Command
 *
 * Allows a bot admin to make the bot leave a thread:
 *
 *   /out              — bot leaves the current thread silently
 *   /out <threadID>   — bot leaves the specified thread and confirms in the current thread
 *
 * Restricted to BOT_ADMIN and above: ejecting the bot from a thread is an irreversible
 * moderation action that permanently removes it from that conversation's session. Thread
 * admins cannot perform this action because they operate within a single thread scope and
 * should not be able to remove the bot globally across sessions they did not create.
 *
 * Platform notes:
 *   Discord      — bot leaves the guild channel; requires MANAGE_GUILD or KICK_MEMBERS.
 *   Telegram     — bot leaves the group chat via Bot API leaveChat.
 *   FB Messenger — bot removes itself via fca-unofficial removeUserFromGroup.
 *   FB Page      — NOT supported (always 1:1; there is no "group" to leave).
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

export const config: CommandConfig = {
  name: 'out',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'John Lester',
  description: 'Make the bot leave the current or a specified thread',
  category: 'System',
  usage: '<threadID>',
  cooldown: 3,
  hasPrefix: true,
  // FB Page is always 1:1 — removeUserFromGroup is not applicable there
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

export const onCommand = async ({
  bot,
  chat,
  event,
  args,
  prefix
}: AppCtx): Promise<void> => {
  const targetThreadID = args[0];
  const currentThreadID = event['threadID'] as string;

  const isGroup = event['isGroup'] as boolean;

  // DM guard: bot.leave() without a target threadID is semantically invalid in a private
  // conversation — there is no group membership to eject from on any supported platform.
  // Require an explicit threadID arg so the admin can still eject from a group thread
  // while invoking the command from inside a DM context.
  if (!targetThreadID && !isGroup) {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: [
        'Cannot leave a private conversation.',
        '',
        `Use ${prefix}out <threadID> to leave a group thread.`,
      ].join('\n'),
    });
    return;
  }

  // ── Path 1: No threadID supplied — leave the current conversation ─────────
  // Send the goodbye before leaving so the message can be delivered while the bot
  // is still a member. The leave call immediately follows; delivery is best-effort
  // because some platforms process the removal before the message is flushed.
  if (!targetThreadID) {
    try {
      await chat.replyMessage({
        style: MessageStyle.TEXT,
        message: 'The bot has left this group.',
      });
    } catch {
      // Fail-open — the leave still proceeds even if the farewell cannot be sent
    }
    await bot.leave(targetThreadID);
    return;
  }

  // ── Path 2: Explicit threadID — leave the other thread then confirm here ──
  // Confirm in the invoker's thread AFTER leaving so the admin knows the action
  // succeeded. If the bot is not a member of the target thread, removeUserFromGroup
  // will throw and the catch block below surfaces the reason.
  if (targetThreadID === currentThreadID) {
    // Invoker passed their own threadID explicitly — treat the same as no-arg
    try {
      await chat.replyMessage({
        style: MessageStyle.TEXT,
        message: 'The bot has left this group.',
      });
    } catch {
      /* fail-open */
    }
    await bot.leave();
    return;
  }

  try {
    await bot.leave(targetThreadID);
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `The bot has left thread ${targetThreadID}.`,
    });
  } catch (err) {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `Failed to leave thread ${targetThreadID}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};
