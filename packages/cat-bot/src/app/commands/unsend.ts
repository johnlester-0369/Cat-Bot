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
  description: 'Unsend a message — bot-only on FB Messenger, any message on Discord/Telegram (if bot has delete permission)',
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

  // Sender/thread identity extracted here so both the FB Messenger guard and the
  // Discord/Telegram privilege gate below share the same resolved values.
  const senderID = (event['senderID'] ?? event['userID'] ?? '') as string;
  const threadID = (event['threadID'] ?? '') as string;

  // Discord and Telegram support deleting any message when the bot has the
  // appropriate admin permission (MANAGE_MESSAGES / can_delete_messages).
  // Facebook Messenger has no such permission — bot can only unsend its own messages.
  const canDeleteOthers =
    native.platform === Platforms.Discord ||
    native.platform === Platforms.Telegram;

  if (!canDeleteOthers && repliedSenderID !== botID) {
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: "Can't unsend a message from another user on this platform.",
    });
    return;
  }

  // Privilege gate — Discord/Telegram only: deleting another user's message is a
  // destructive moderation action. Any authenticated user could otherwise weaponise
  // the bot to silently purge arbitrary messages. Gate mirrors the enforcePermission
  // hierarchy in on-command.middleware.ts (system admin → bot admin → thread admin).
  if (canDeleteOthers && repliedSenderID !== botID) {
    const sessionUserId = native.userId ?? '';
    const sessionId = native.sessionId ?? '';

    // System admins carry global authority — short-circuit before any DB join.
    const isSysAdmin = senderID ? await isSystemAdmin(senderID) : false;

    if (!isSysAdmin) {
      // Bot admins are provisioned per-owner-session via the web dashboard;
      // they inherit all moderation rights within their session scope.
      const isAdmin = senderID
        ? await isBotAdmin(sessionUserId, native.platform, sessionId, senderID)
        : false;

      if (!isAdmin) {
        // Thread-admin check: on Discord, isThreadAdmin resolves against the parent
        // server's admin list (matching slash-command semantics). On Telegram it checks
        // the group admin roster. Either way — only a recognised admin may delete
        // another member's message through the bot.
        const isThreadAdm =
          senderID && threadID
            ? await isThreadAdmin(threadID, senderID)
            : false;

        if (!isThreadAdm) {
          await chat.replyMessage({
            style: MessageStyle.TEXT,
            message: "Only thread admins can delete other users' messages.",
          });
          return;
        }
      }
    }
  }

  await chat.unsendMessage(repliedMessageID);
};
