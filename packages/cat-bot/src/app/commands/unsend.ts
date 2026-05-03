import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';

export const config: CommandConfig = {
  name: 'unsend',
  version: '1.0.2',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Unsend a message — bot-only on FB Messenger, any message on Discord/Telegram (if bot has delete permission)',
  category: 'system',
  usage: '<reply to message>',
  cooldown: 3,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

export const onCommand = async ({
  chat,
  event,
  bot,
  native,
}: AppCtx): Promise<void> => {
  // Guard: command must be used as a reply to a message
  if (event['type'] !== 'message_reply') {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: 'Reply to the message you want to unsend.',
    });
    return;
  }

  const messageReply = event['messageReply'] as Record<string, unknown> | null;

  // Guard: the nested reply payload must be present
  if (!messageReply) {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: 'Reply to the message you want to unsend.',
    });
    return;
  }

  const repliedMessageID = messageReply['messageID'] as string;
  const repliedSenderID = messageReply['senderID'] as string;
  const botID = await bot.getID();

  const senderID = (event['senderID'] ?? event['userID'] ?? '') as string;
  const threadID = (event['threadID'] ?? '') as string;

  // Discord and Telegram support deleting any message when the bot has the
  // appropriate admin permission (MANAGE_MESSAGES / can_delete_messages).
  // Facebook Messenger has no such permission — bot can only unsend its own messages.
  const canDeleteOthers =
    native.platform === Platforms.Discord ||
    native.platform === Platforms.Telegram;

  // ── Path 1: Non-Discord/Telegram (FB Messenger) ───────────────────────────
  // Platform has no delete-others API permission — restrict to bot-owned messages only.
  if (!canDeleteOthers) {
    if (repliedSenderID !== botID) {
      await chat.replyMessage({
        style: MessageStyle.TEXT,
        message: "Can't unsend a message from another user on this platform.",
      });
      return;
    }
    // Replied message is the bot's own — proceed directly.
    await chat.unsendMessage(repliedMessageID);
    return;
  }

  // ── Path 2: Discord / Telegram ────────────────────────────────────────────
  // Bot's own message: any invoker may delete it — no privilege check needed.
  if (repliedSenderID === botID) {
    await chat.unsendMessage(repliedMessageID);
    return;
  }

  // Replied message belongs to another user — deleting it is a moderation action.
  // Gate mirrors the enforcePermission hierarchy in on-command.middleware.ts:
  //   system admin → bot admin → thread admin → deny
  // This prevents any authenticated user from weaponising the bot's
  // MANAGE_MESSAGES / can_delete_messages permission to silently purge others' messages.
  const sessionUserId = native.userId ?? '';
  const sessionId = native.sessionId ?? '';

  // System admins carry global authority — short-circuit before any DB join.
  const isSysAdmin = senderID ? await isSystemAdmin(senderID) : false;
  if (isSysAdmin) {
    await chat.unsendMessage(repliedMessageID);
    return;
  }

  // Bot admins are provisioned per-owner-session and inherit full moderation rights.
  const isAdmin = senderID
    ? await isBotAdmin(sessionUserId, native.platform, sessionId, senderID)
    : false;
  if (isAdmin) {
    await chat.unsendMessage(repliedMessageID);
    return;
  }

  // Thread-admin check: on Discord, isThreadAdmin resolves against the parent server's
  // admin list (matching slash-command semantics). On Telegram it checks the group
  // admin roster. Either way — only a recognised admin may delete another member's message.
  const isThreadAdm =
    senderID && threadID ? await isThreadAdmin(threadID, senderID) : false;

  if (!isThreadAdm) {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: "Only thread admins can delete other users' messages.",
    });
    return;
  }

  await chat.unsendMessage(repliedMessageID);
};
