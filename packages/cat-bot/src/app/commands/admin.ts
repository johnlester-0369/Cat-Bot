import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  addBotAdmin,
  removeBotAdmin,
  listBotAdmins,
  isBotAdmin,
} from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'admin',
  aliases: [] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Manage bot admins for this session: add, list, or remove by user ID',
  category: 'Admin',
  usage: '<add|list|remove> [uid]',
  cooldown: 5,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'Action to perform: add, list, delete, or remove',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'uid',
      description: 'Platform user ID (required for add, delete, and remove actions)',
      required: false,
    },
  ],
};

export const onCommand = async ({
  chat,
  user,
  args,
  event,
  native,
  usage,
}: AppCtx): Promise<void> => {
  const { userId, platform, sessionId } = native;
  const senderID = event['senderID'] as string | undefined;

  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Cannot resolve session identity — admin commands are unavailable.',
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  if (sub === 'add' || sub === 'delete' || sub === 'remove') {
    // System admins hold global authority and may always manage bot admins.
    // Bot admins may manage bot admins within their own session.
    const callerIsAuthorised = senderID
      ? (await isSystemAdmin(senderID)) ||
        (await isBotAdmin(userId, platform, sessionId, senderID))
      : false;

    if (!callerIsAuthorised) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🚫 Only bot admins or system admins can add or remove admins.',
      });
      return;
    }
  }

  if (sub === 'add') {
    const uid = args[1];
    if (!uid) {
      await usage();
      return;
    }
    await addBotAdmin(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${userName}** is now a bot admin for this session.`,
    });
    return;
  }

  if (sub === 'list') {
    const admins = await listBotAdmins(userId, platform, sessionId);
    if (admins.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: 'ℹ️ No bot admins registered for this session.',
      });
      return;
    }
    const names = await Promise.all(
      admins.map((id: string) => user.getName(id)),
    );
    const lines = admins
      .map((id: string, i: number) => `${i + 1}. **${names[i] ?? id}** (${id})`)
      .join('\n');
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**Bot admins for this session (${admins.length}):**\n${lines}`,
    });
    return;
  }

  // Support both 'delete' and 'remove' keywords for better UX
  if (sub === 'delete' || sub === 'remove') {
    const uid = args[1];
    if (!uid) {
      await usage();
      return;
    }
    await removeBotAdmin(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${userName}** has been removed from bot admins.`,
    });
    return;
  }

  await usage();
};
