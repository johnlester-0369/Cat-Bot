/**
 * warn.ts — Cat-Bot command
 * Ported from GoatBot warn.js by NTKhang.
 *
 * Subcommands:
 *   warn @tag [reason]         — warn a member (admin only)
 *   warn list                  — list warned members (open)
 *   warn listban               — list banned members / ≥3 warns (open)
 *   warn info [@tag|<uid>]     — view warning details (open)
 *   warn unban [@tag|<uid>]    — unban a member (admin only)
 *   warn unwarn [@tag|<uid>] [#] — remove a warning (admin only)
 *   warn reset                 — reset all warn data (admin only)
 *
 * Data is stored at:
 *   db.threads.collection(threadID) → 'warn' collection → key 'list'
 *   Shape: WarnedUser[]
 *
 * ⚠️ GAP — admin check per subcommand:
 *   Cat-Bot enforces config.role globally, not per-subcommand.
 *   This file uses thread.getInfo() to check adminIDs at runtime.
 *   The shape of UnifiedThreadInfo.adminIDs is not documented —
 *   the check is defensive (wrapped in try/catch, fails open to
 *   "not admin" which is the safe direction for a moderation command).
 *
 * ⚠️ GAP — deferred kick queue (global.GoatBot.onEvent):
 *   The original queued a re-kick when the bot was promoted to admin mid-flow.
 *   Cat-Bot has no documented equivalent. If thread.removeUser() fails, the
 *   bot replies asking for admin permissions — a re-try must be done manually.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ─── Data shapes ─────────────────────────────────────────────────────────────

interface WarnEntry {
  reason: string;
  dateTime: string;
  warnBy: string;
}

interface WarnedUser {
  uid: string;
  list: WarnEntry[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'warn',
  version: '1.8.0',
  role: Role.ANYONE, // open; per-subcommand admin gate is inside the handler
  author: 'NTKhang (Cat-Bot port)',
  description: 'Warn group members — 3 warnings results in a ban',
  cooldown: 5,
  hasPrefix: true,
  category: 'thread',
  usage: [
    '@tag <reason> — Warn a member (admin only)',
    'list — List warned members',
    'listban — List members banned via warns (≥3)',
    'info [@tag | <uid>] — View warning details (self if blank)',
    'unban [@tag | <uid>] — Unban a member (admin only)',
    'unwarn [@tag | <uid>] [#] — Remove a specific warning (admin only)',
    'reset — Reset all warn data (admin only)',
    '',
    '⚠️ Bot must be a group admin to auto-kick banned members.',
  ],
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns current local time as DD/MM/YYYY HH:mm:ss */
function getDateTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** Reads the WarnedUser list from the thread's 'warn' collection. */
async function getWarnList(
  db: AppCtx['db'],
  threadID: string,
): Promise<WarnedUser[]> {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('warn')))
    await coll.createCollection('warn');
  const warn = await coll.getCollection('warn');
  return ((await warn.get('list')) as WarnedUser[] | null) ?? [];
}

/** Writes the WarnedUser list back to the thread's 'warn' collection. */
async function saveWarnList(
  db: AppCtx['db'],
  threadID: string,
  list: WarnedUser[],
): Promise<void> {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('warn')))
    await coll.createCollection('warn');
  const warn = await coll.getCollection('warn');
  await warn.set('list', list);
}

/**
 * Checks whether senderID is a thread admin via thread.getInfo().
 * ⚠️ UnifiedThreadInfo.adminIDs shape is undocumented — handled defensively.
 * Returns false on any error (safe default for a moderation action).
 */
async function isThreadAdmin(
  thread: AppCtx['thread'],
  senderID: string,
): Promise<boolean> {
  try {
    const info = (await thread.getInfo()) as unknown as Record<string, unknown>;
    const adminIDs = info['adminIDs'] as
      | Array<string | { uid: string }>
      | undefined;
    if (!Array.isArray(adminIDs)) return false;
    return adminIDs.some(
      (a) => (typeof a === 'string' ? a : a.uid) === senderID,
    );
  } catch {
    return false;
  }
}

// ─── Command handler ─────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  args,
  db,
  thread,
  user,
  usage,
  prefix,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;
  const mentions =
    (event['mentions'] as Record<string, string> | undefined) ?? {};
  const msgReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  // ── No subcommand — show usage ───────────────────────────────────────────
  if (!args[0]) {
    await usage();
    return;
  }

  const warnList = await getWarnList(db, threadID);

  switch (args[0]) {
    // ── list ─────────────────────────────────────────────────────────────────
    case 'list': {
      if (!warnList.length) {
        await chat.replyMessage({
          message: 'No members have been warned in this group.',
        });
        return;
      }
      const lines = await Promise.all(
        warnList.map(
          async ({ uid, list }) =>
            `${await user.getName(uid)} (${uid}): ${list.length} warn(s)`,
        ),
      );
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `**Warned members:**\n${lines.join('\n')}\n\nUse \`${prefix}warn info @tag\` to see details.`,
      });
      break;
    }

    // ── listban ───────────────────────────────────────────────────────────────
    case 'listban': {
      const banned = await Promise.all(
        warnList
          .filter((u) => u.list.length >= 3)
          .map(async ({ uid }) => `${await user.getName(uid)} (${uid})`),
      );
      if (!banned.length) {
        await chat.replyMessage({
          message: 'No members have been banned from this group.',
        });
        return;
      }
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `**Banned members (≥3 warns):**\n${banned.join('\n')}`,
      });
      break;
    }

    // ── info / check ──────────────────────────────────────────────────────────
    case 'check':
    case 'info': {
      // Resolve UIDs: mentions → reply sender → positional args → self
      const uids: string[] = Object.keys(mentions).length
        ? Object.keys(mentions)
        : msgReply?.['senderID']
          ? [msgReply['senderID'] as string]
          : args.length > 1
            ? args.slice(1)
            : [senderID];

      const lines: string[] = [];
      for (const uid of uids) {
        if (isNaN(Number(uid))) continue;
        const name = await user.getName(uid);
        const entry = warnList.find((u) => u.uid === uid);
        if (!entry?.list.length) {
          lines.push(`**${name}** (${uid}): No warnings on record.`);
        } else {
          const entries = entry.list
            .map((w, i) => `  ${i + 1}. ${w.reason} — ${w.dateTime}`)
            .join('\n');
          lines.push(`**${name}** (${uid}):\n${entries}`);
        }
      }
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: lines.join('\n\n') || 'No data found.',
      });
      break;
    }

    // ── unban ─────────────────────────────────────────────────────────────────
    case 'unban': {
      if (!(await isThreadAdmin(thread, senderID))) {
        await chat.replyMessage({
          message: '❌ Only group administrators can unban members.',
        });
        return;
      }

      // Resolve UID: mentions → reply → positional arg → self
      const uidUnban: string =
        Object.keys(mentions)[0] ??
        (msgReply?.['senderID'] as string | undefined) ??
        args[1] ??
        senderID;

      if (!uidUnban || isNaN(Number(uidUnban))) {
        await chat.replyMessage({
          message: '⚠️ Please provide a valid uid to unban.',
        });
        return;
      }

      const idx = warnList.findIndex(
        (u) => u.uid === uidUnban && u.list.length >= 3,
      );
      if (idx === -1) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: `⚠️ User \`${uidUnban}\` is not banned from this group.`,
        });
        return;
      }

      warnList.splice(idx, 1);
      await saveWarnList(db, threadID, warnList);

      const name = await user.getName(uidUnban);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `✅ **${name}** (${uidUnban}) has been unbanned and may rejoin the group.`,
      });
      break;
    }

    // ── unwarn ────────────────────────────────────────────────────────────────
    case 'unwarn': {
      if (!(await isThreadAdmin(thread, senderID))) {
        await chat.replyMessage({
          message: '❌ Only group administrators can remove warnings.',
        });
        return;
      }

      // Resolve UID and optional warn-index
      let uid: string | undefined;
      let numStr: string | undefined;

      if (Object.keys(mentions)[0]) {
        uid = Object.keys(mentions)[0];
        numStr = args[args.length - 1]; // last token after @mention line
      } else if (msgReply?.['senderID']) {
        uid = msgReply['senderID'] as string;
        numStr = args[1];
      } else {
        uid = args[1];
        numStr = args[2];
      }

      if (!uid || isNaN(Number(uid))) {
        await chat.replyMessage({
          message: '⚠️ Please tag or provide the uid of the member to unwarn.',
        });
        return;
      }

      const entry = warnList.find((u) => u.uid === uid);
      if (!entry?.list.length) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: `⚠️ User \`${uid}\` has no warning data.`,
        });
        return;
      }

      // numStr is 1-indexed from the user; convert to 0-indexed. Default = last entry.
      const num = isNaN(Number(numStr))
        ? entry.list.length - 1
        : Number(numStr) - 1;
      const name = await user.getName(uid);

      if (num < 0 || num >= entry.list.length) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: `❌ **${name}** only has ${entry.list.length} warning(s).`,
        });
        return;
      }

      entry.list.splice(num, 1);
      // If no warns remain, remove the user entry entirely
      if (!entry.list.length)
        warnList.splice(
          warnList.findIndex((u) => u.uid === uid),
          1,
        );
      await saveWarnList(db, threadID, warnList);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `✅ Removed warning #${num + 1} from **${name}** (${uid}).`,
      });
      break;
    }

    // ── reset ─────────────────────────────────────────────────────────────────
    case 'reset': {
      if (!(await isThreadAdmin(thread, senderID))) {
        await chat.replyMessage({
          message: '❌ Only group administrators can reset warning data.',
        });
        return;
      }
      await saveWarnList(db, threadID, []);
      await chat.replyMessage({
        message: '✅ All warning data has been reset.',
      });
      break;
    }

    // ── default: warn a member ────────────────────────────────────────────────
    default: {
      if (!(await isThreadAdmin(thread, senderID))) {
        await chat.replyMessage({
          message: '❌ Only group administrators can warn members.',
        });
        return;
      }

      // Resolve target UID and reason
      let uid: string | undefined;
      let reason: string;

      if (msgReply?.['senderID']) {
        // Reply-to path — entire args string is the reason
        uid = msgReply['senderID'] as string;
        reason = args.join(' ').trim();
      } else if (Object.keys(mentions)[0]) {
        // @mention path — strip mention text from reason
        uid = Object.keys(mentions)[0];
        reason = args
          .join(' ')
          .replace(mentions[uid!] ?? '', '')
          .trim();
      } else {
        await chat.replyMessage({
          message: '⚠️ Please tag or reply to the member you want to warn.',
        });
        return;
      }

      if (!reason) reason = 'No reason provided';

      const dateTime = getDateTime();
      const existing = warnList.find((u) => u.uid === uid);

      if (!existing) {
        warnList.push({
          uid: uid!,
          list: [{ reason, dateTime, warnBy: senderID }],
        });
      } else {
        existing.list.push({ reason, dateTime, warnBy: senderID });
      }
      await saveWarnList(db, threadID, warnList);

      const times = existing ? existing.list.length : 1;
      const userName = await user.getName(uid!);

      if (times >= 3) {
        // 3rd (or more) warn → ban
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: [
            `⚠️ **${userName}** has been warned **${times}** time(s) and is now banned from this group.`,
            `- **Uid:** ${uid}`,
            `- **Reason:** ${reason}`,
            `- **Date:** ${dateTime}`,
            `\nTo unban: \`${prefix}warn unban ${uid}\``,
          ].join('\n'),
        });
        // Attempt to kick. If bot lacks admin, notify and stop.
        // ⚠️ GAP: The original queued a retry once the bot became admin.
        // Cat-Bot has no documented equivalent for that deferred pattern.
        try {
          await thread.removeUser(uid!);
        } catch {
          await chat.replyMessage({
            message:
              '⚠️ Bot needs administrator permissions to remove banned members.',
          });
        }
      } else {
        // Under 3 warns — notify remaining count
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: [
            `⚠️ **${userName}** has been warned **${times}** time(s).`,
            `- **Uid:** ${uid}`,
            `- **Reason:** ${reason}`,
            `- **Date:** ${dateTime}`,
            `\n${3 - times} more violation(s) will result in a ban.`,
          ].join('\n'),
        });
      }
      break;
    }
  }
};
