/**
 * ignoreonlyadbox.ts — Cat-Bot port of GoatBot ignoreonlyadbox by NTKhang
 *
 * Manages the per-thread list of commands that are exempt from the
 * onlyadminbox restriction. When onlyadminbox is enabled, commands on
 * this list remain usable by all members regardless of admin status.
 *
 * ⚠️ GAP — command existence check:
 *   GoatBot verified the command name via global.GoatBot.commands.get().
 *   Cat-Bot's documented API provides no equivalent. The check is omitted;
 *   any string can be added to the ignore list.
 *
 * DB schema: same 'adminbox_settings' collection as onlyadminbox.
 *   ignoreList: string[]  — command names exempt from enforcement
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'ignoreonlyadbox',
  aliases: ['ignoreadboxonly', 'ignoreadminboxonly'] as string[],
  version: '1.2.0',
  role: Role.BOT_ADMIN,
  author: 'NTKhang (Cat-Bot port)',
  description:
    'Manage commands exempt from the per-thread admin-only restriction.',
  category: 'Thread Admin',
  usage: [
    'add <commandName> — Add a command to the thread ignore list',
    'del <commandName> — Remove a command from the thread ignore list',
    'list — View the current thread ignore list',
  ],
  cooldown: 5,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── DB helper (shared schema with onlyadminbox) ────────────────────────────────

async function getHandle(db: AppCtx['db'], threadID: string) {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('adminbox_settings'))) {
    await coll.createCollection('adminbox_settings');
    const h = await coll.getCollection('adminbox_settings');
    await h.set('enabled', false);
    await h.set('hideNoti', false);
    await h.set('ignoreList', []);
    return h;
  }
  return coll.getCollection('adminbox_settings');
}

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  args,
  db,
  usage,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string;
  const sub = args[0]?.toLowerCase();
  const handle = await getHandle(db, threadID);

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  // ── add ───────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    if (!args[1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ Please enter the command name you want to add to the ignore list.',
      });
      return;
    }
    const commandName = args[1].toLowerCase();
    const ignoreList =
      ((await handle.get('ignoreList')) as string[] | null) ?? [];

    if (ignoreList.includes(commandName)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is already in the ignore list.`,
      });
      return;
    }

    ignoreList.push(commandName);
    await handle.set('ignoreList', ignoreList);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Added **${commandName}** to the thread ignore list.`,
    });
    return;
  }

  // ── del / delete / remove / rm / -d ──────────────────────────────────────
  if (['del', 'delete', 'remove', 'rm', '-d'].includes(sub ?? '')) {
    if (!args[1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ Please enter the command name you want to remove from the ignore list.',
      });
      return;
    }
    const commandName = args[1].toLowerCase();
    const ignoreList =
      ((await handle.get('ignoreList')) as string[] | null) ?? [];
    const idx = ignoreList.indexOf(commandName);

    if (idx === -1) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is not in the ignore list.`,
      });
      return;
    }

    ignoreList.splice(idx, 1);
    await handle.set('ignoreList', ignoreList);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Removed **${commandName}** from the thread ignore list.`,
    });
    return;
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const ignoreList =
      ((await handle.get('ignoreList')) as string[] | null) ?? [];
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        ignoreList.length === 0
          ? '📑 The thread ignore list is currently empty.'
          : `📑 Commands exempt from admin-only in this thread:\n${ignoreList.join(', ')}`,
    });
    return;
  }

  return usage();
};
