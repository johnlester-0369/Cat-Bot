/**
 * onlyadminbox.ts — Cat-Bot port of GoatBot onlyadminbox by NTKhang
 *
 * Toggles a per-thread mode where only group admins can use the bot.
 * Also toggles whether non-admins receive a notification when blocked.
 *
 * DB schema (db.threads.collection(threadID) → 'adminbox_settings'):
 *   enabled:    boolean  — admin-only enforcement active for this thread
 *   hideNoti:   boolean  — suppress the "not an admin" reply when blocked
 *   ignoreList: string[] — command names exempt from enforcement
 *                          (managed separately by ignoreonlyadbox)
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'onlyadminbox',
  aliases: ['onlyadbox', 'adboxonly', 'adminboxonly'] as string[],
  version: '1.3.0',
  role: Role.THREAD_ADMIN,
  author: 'NTKhang (Cat-Bot port)',
  description:
    'Turn on/off the mode where only group admins can use the bot in this thread.',
  category: 'Thread Admin',
  usage: [
    '[on | off] — Enable/disable admin-only mode for this thread',
    'noti [on | off] — Enable/disable the blocked-user notification',
  ],
  cooldown: 5,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── DB helper ─────────────────────────────────────────────────────────────────

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

  let isNoti = false;
  let argIndex = 0;

  if (args[0]?.toLowerCase() === 'noti') {
    isNoti = true;
    argIndex = 1;
  }

  const toggle = args[argIndex]?.toLowerCase();
  if (toggle !== 'on' && toggle !== 'off') return usage();

  const value = toggle === 'on';
  const handle = await getHandle(db, threadID);

  if (isNoti) {
    // hideNoti is the inverse of "noti on" — enabling notifications means NOT hiding them
    await handle.set('hideNoti', !value);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: value
        ? '✅ Notification **enabled** — non-admins will be told when they are blocked.'
        : '✅ Notification **disabled** — non-admins will be silently ignored.',
    });
  } else {
    await handle.set('enabled', value);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: value
        ? '✅ Admin-only mode **enabled** — only group admins can use the bot in this thread.'
        : '✅ Admin-only mode **disabled** — all users can use the bot in this thread.',
    });
  }
};
