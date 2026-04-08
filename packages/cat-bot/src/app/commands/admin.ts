import type { ChatContext } from '@/engine/adapters/models/context.model.js';
import type { NativeContext } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  addBotAdmin,
  removeBotAdmin,
  listBotAdmins,
  isBotAdmin,
} from '@/engine/repos/credentials.repo.js';
import { OptionType } from '@/engine/constants/command-option.constants.js';

export const config = {
  name: 'admin',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Manage bot admins for this session: add, list, or delete by platform user ID',
  category: 'Admin',
  usage: '<add|list|delete> [uid]',
  cooldown: 5,
  hasPrefix: true,
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
  args,
  native,
}: {
  chat: ChatContext;
  args: string[];
  native: NativeContext;
}): Promise<void> => {
  const { userId, platform, sessionId } = native;

  // senderID is the platform user who issued the command — needed for isBotAdmin lookup
  const senderID = native['senderID'] as string | undefined;

  // Session identity is mandatory — all three repo functions need all three coordinates.
  // This guard should never fire in normal operation; it exists for defensive correctness.
  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      message: '❌ Cannot resolve session identity — admin commands are unavailable.',
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
      await chat.replyMessage({ message: '🚫 Only bot admins can add or remove admins.' });
      return;
    }
  }

  // ── /admin add <uid> ───────────────────────────────────────────────────────
  if (sub === 'add') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({ message: '❌ Usage: /admin add <uid>' });
      return;
    }
    await addBotAdmin(userId, platform, sessionId, uid);
    await chat.replyMessage({ message: `✅ ${uid} is now a bot admin for this session.` });
    return;
  }

  // ── /admin list ────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const admins = await listBotAdmins(userId, platform, sessionId);
    if (admins.length === 0) {
      await chat.replyMessage({ message: 'ℹ️ No bot admins registered for this session.' });
      return;
    }
    const lines = admins.map((id: string, i: number) => `${i + 1}. ${id}`).join('\n');
    await chat.replyMessage({
      message: `Bot admins for this session (${admins.length}):\n${lines}`,
    });
    return;
  }

  // ── /admin delete <uid> ────────────────────────────────────────────────────
  if (sub === 'delete') {
    const uid = args[1];
    if (!uid) {
      await chat.replyMessage({ message: '❌ Usage: /admin delete <uid>' });
      return;
    }
    await removeBotAdmin(userId, platform, sessionId, uid);
    await chat.replyMessage({ message: `✅ ${uid} has been removed from bot admins.` });
    return;
  }

  // ── Unknown or missing sub-command ────────────────────────────────────────
  await chat.replyMessage({
    message: [
      'Usage:',
      '  /admin add <uid>    — Grant bot admin rights',
      '  /admin list         — List all bot admins',
      '  /admin delete <uid> — Revoke bot admin rights',
    ].join('\n'),
  });
};
