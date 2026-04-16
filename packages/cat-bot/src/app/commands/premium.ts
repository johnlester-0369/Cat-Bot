import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  isBotAdmin,
  addBotPremium,
  removeBotPremium,
  listBotPremiums,
  isBotPremium,
} from '@/engine/repos/credentials.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'premium',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Manage premium users for this session: add, list, or delete by platform user ID',
  category: 'Admin',
  usage: '<add|list|delete> [uid]',
  cooldown: 5,
  hasPrefix: true,
  // Exclude Facebook Page — PSIDs are page-scoped and not portable across contexts,
  // making user lookups unreliable for premium management on that platform.
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

  // senderID is the platform user who issued the command — needed for isBotAdmin lookup.
  const senderID = native['senderID'] as string | undefined;

  // Session identity is mandatory — all three repo functions need all three coordinates.
  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Cannot resolve session identity — premium commands are unavailable.',
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── Privilege check for write operations ──────────────────────────────────
  // /premium list is intentionally open to all users so anyone in a group can see
  // the premium roster. add and delete mutate the roster and are gated to bot admins
  // only — premium users themselves cannot promote or demote others.
  if (sub === 'add' || sub === 'delete') {
    const callerIsBotAdmin = senderID
      ? await isBotAdmin(userId, platform, sessionId, senderID)
      : false;
    if (!callerIsBotAdmin) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🚫 Only bot admins can add or remove premium users.',
      });
      return;
    }
  }

  // ── /premium add <uid> ─────────────────────────────────────────────────────
  if (sub === 'add') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}premium add <uid>`,
      });
      return;
    }
    // Guard against duplicate promotion — a clear message is more helpful than a silent no-op.
    const alreadyPremium = await isBotPremium(userId, platform, sessionId, uid);
    if (alreadyPremium) {
      const userName = await user.getName(uid);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `ℹ️ **${userName}** is already a premium user for this session.`,
      });
      return;
    }
    await addBotPremium(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${userName}** is now a premium user for this session.`,
    });
    return;
  }

  // ── /premium list ──────────────────────────────────────────────────────────
  if (sub === 'list') {
    const premiums = await listBotPremiums(userId, platform, sessionId);
    if (premiums.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: 'ℹ️ No premium users registered for this session.',
      });
      return;
    }
    // Resolve all display names in parallel — falls back to the raw platform ID when unavailable.
    const names = await Promise.all(
      premiums.map((id: string) => user.getName(id)),
    );
    // Append the raw ID so admins can copy it directly for the 'delete' sub-command.
    const lines = premiums
      .map((id: string, i: number) => `${i + 1}. **${names[i] ?? id}** (${id})`)
      .join('\n');
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**Premium users for this session (${premiums.length}):**\n${lines}`,
    });
    return;
  }

  // ── /premium delete <uid> ──────────────────────────────────────────────────
  if (sub === 'delete') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}premium delete <uid>`,
      });
      return;
    }
    await removeBotPremium(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${userName}** has been removed from premium users.`,
    });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      'Usage:',
      `  ${prefix}premium add <uid>    — Grant premium access`,
      `  ${prefix}premium list         — List all premium users`,
      `  ${prefix}premium delete <uid> — Revoke premium access`,
    ].join('\n'),
  });
};