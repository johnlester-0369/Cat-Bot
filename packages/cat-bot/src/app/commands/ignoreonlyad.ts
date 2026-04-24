/**
 * ignoreonlyad.ts — Cat-Bot port of GoatBot ignoreonlyad by NTKhang
 *
 * Manages the session-wide list of commands exempt from the adminonly
 * restriction. When adminonly is enabled, commands on this list remain
 * usable by all users regardless of bot-admin status.
 *
 * ⚠️ GAP — command existence check:
 *   GoatBot verified the command name via global.GoatBot.commands.get().
 *   Cat-Bot's documented API provides no equivalent. The check is omitted.
 *
 * ⚠️ GAP — in-memory global list:
 *   GoatBot mutated global.GoatBot.config.adminOnly.ignoreCommand directly
 *   and persisted it via fs.writeFileSync. In Cat-Bot this is stored in
 *   db.users.collection(native.userId) → 'session_settings' → 'adminOnlyIgnoreList',
 *   which is correctly scoped per session and persisted by the db layer.
 *
 * DB schema: same 'session_settings' collection as adminonly.
 *   adminOnlyIgnoreList: string[]  — command names exempt from enforcement
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role }         from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name:        'ignoreonlyad',
  aliases:     ['ignoreadonly', 'ignoreonlyadmin', 'ignoreadminonly'] as string[],
  version:     '1.2.0',
  role:        Role.BOT_ADMIN,
  author:      'NTKhang (Cat-Bot port)',
  description: 'Manage commands exempt from the session-wide admin-only restriction.',
  category:    'Admin',
  usage: [
    'add <commandName> — Add a command to the session ignore list',
    'del <commandName> — Remove a command from the session ignore list',
    'list — View the current session ignore list',
  ],
  cooldown:  5,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── DB helper (shared schema with adminonly) ───────────────────────────────────

async function getSessionHandle(db: AppCtx['db'], ownerUserId: string) {
  const coll = db.users.collection(ownerUserId);
  if (!(await coll.isCollectionExist('session_settings'))) {
    await coll.createCollection('session_settings');
    const h = await coll.getCollection('session_settings');
    await h.set('adminOnlyEnabled',    false);
    await h.set('adminOnlyHideNoti',   false);
    await h.set('adminOnlyIgnoreList', []);
    return h;
  }
  return coll.getCollection('session_settings');
}

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat, args, db, native, usage,
}: AppCtx): Promise<void> => {
  const ownerUserId = native.userId ?? '';

  if (!ownerUserId) {
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: '❌ Cannot resolve session identity — ignoreonlyad is unavailable.',
    });
    return;
  }

  const sub    = args[0]?.toLowerCase();
  const handle = await getSessionHandle(db, ownerUserId);

  // ── add ───────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    if (!args[1]) {
      await chat.replyMessage({
        style:   MessageStyle.MARKDOWN,
        message: '⚠️ Please enter the command name you want to add to the ignore list.',
      });
      return;
    }
    const commandName = args[1].toLowerCase();
    const ignoreList  = ((await handle.get('adminOnlyIgnoreList')) as string[] | null) ?? [];

    if (ignoreList.includes(commandName)) {
      await chat.replyMessage({
        style:   MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is already in the ignore list.`,
      });
      return;
    }

    ignoreList.push(commandName);
    await handle.set('adminOnlyIgnoreList', ignoreList);
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: `✅ Added **${commandName}** to the admin-only ignore list.`,
    });
    return;
  }

  // ── del / delete / remove / rm / -d ──────────────────────────────────────
  if (['del', 'delete', 'remove', 'rm', '-d'].includes(sub ?? '')) {
    if (!args[1]) {
      await chat.replyMessage({
        style:   MessageStyle.MARKDOWN,
        message: '⚠️ Please enter the command name you want to remove from the ignore list.',
      });
      return;
    }
    const commandName = args[1].toLowerCase();
    const ignoreList  = ((await handle.get('adminOnlyIgnoreList')) as string[] | null) ?? [];
    const idx         = ignoreList.indexOf(commandName);

    if (idx === -1) {
      await chat.replyMessage({
        style:   MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is not in the ignore list.`,
      });
      return;
    }

    ignoreList.splice(idx, 1);
    await handle.set('adminOnlyIgnoreList', ignoreList);
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: `✅ Removed **${commandName}** from the admin-only ignore list.`,
    });
    return;
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const ignoreList = ((await handle.get('adminOnlyIgnoreList')) as string[] | null) ?? [];
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: ignoreList.length === 0
        ? '📑 The admin-only ignore list is currently empty.'
        : `📑 Commands exempt from admin-only (session-wide):\n${ignoreList.join(', ')}`,
    });
    return;
  }

  return usage();
};