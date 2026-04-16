import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  addBotAdmin,
  removeBotAdmin,
  listBotAdmins,
  isBotAdmin,
} from '@/engine/repos/credentials.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'admin',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Manage bot admins for this session: add, list, or delete by platform user ID',
  category: 'Admin',
  usage: '<add|list|delete> [uid]',
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
      description: 'Action to perform: add, list, or delete',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'uid',
      description: 'Platform user ID (required for add and delete actions)',
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

  // senderID is the platform user who issued the command — needed for isBotAdmin lookup
  const senderID = native['senderID'] as string | undefined;

  // Session identity is mandatory — all three repo functions need all three coordinates.
  // This guard should never fire in normal operation; it exists for defensive correctness.
  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Cannot resolve session identity — admin commands are unavailable.',
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── Privilege check for write operations ──────────────────────────────────
  // /admin list is intentionally open to all users so anyone in a group can see
  // who the bot admins are.  add and delete mutate the admin roster and are
  // therefore gated to existing bot admins, equivalent to the old Role.BOT_ADMIN
  // contract but enforced at the sub-command level instead of globally.
  if (sub === 'add' || sub === 'delete') {
    const callerIsBotAdmin = senderID
      ? await isBotAdmin(userId, platform, sessionId, senderID)
      : false;
    if (!callerIsBotAdmin) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🚫 Only bot admins can add or remove admins.',
      });
      return;
    }
  }

  // ── /admin add <uid> ───────────────────────────────────────────────────────
  if (sub === 'add') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}admin add <uid>`,
      });
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

  // ── /admin list ────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const admins = await listBotAdmins(userId, platform, sessionId);
    if (admins.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: 'ℹ️ No bot admins registered for this session.',
      });
      return;
    }
    // Resolve all admin display names in parallel — names[i] aligns with admins[i] by index;
    // falls back to the raw ID (noUncheckedIndexedAccess guard) when the name is unavailable.
    const names = await Promise.all(
      admins.map((id: string) => user.getName(id)),
    );
    // Append the raw platform ID so admins can be uniquely identified and copied for the 'delete' command
    const lines = admins
      .map((id: string, i: number) => `${i + 1}. **${names[i] ?? id}** (${id})`)
      .join('\n');
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**Bot admins for this session (${admins.length}):**\n${lines}`,
    });
    return;
  }

  // ── /admin delete <uid> ────────────────────────────────────────────────────
  if (sub === 'delete') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}admin delete <uid>`,
      });
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

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      'Usage:',
      `  ${prefix}admin add <uid>    — Grant bot admin rights`,
      `  ${prefix}admin list         — List all bot admins`,
      `  ${prefix}admin delete <uid> — Revoke bot admin rights`,
    ].join('\n'),
  });
};
