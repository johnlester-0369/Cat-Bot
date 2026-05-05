/**
 * badwords.ts — Cat-Bot port of GoatBot badwords by NTKhang
 *
 * Subcommands:
 *   badwords add <word[,word|word]>  — Add banned word(s) (admin only)
 *   badwords delete <word[,…]>       — Remove banned word(s) (admin only)
 *   badwords list [hide]             — Show banned words (hidden if "hide" supplied)
 *   badwords on                      — Enable enforcement (admin only)
 *   badwords off                     — Disable enforcement (admin only)
 *   badwords unwarn [@mention|uid]   — Remove one warning from a user (admin only)
 *
 * onChat:
 *   Passively scans every message when enforcement is enabled.
 *   First offence → warning. Second offence → kick.
 *
 * DB schema (db.threads.collection(threadID) → 'badwords' collection):
 *   {
 *     words:      string[]                  — the banned word list
 *     enabled:    boolean                   — enforcement toggle (default false)
 *     violations: Record<string, number>    — per-user offence count
 *   }
 *
 * ⚠️ GAP — prefix in onChat:
 *   `prefix` is documented as available in onCommand only.
 *   The original skipped scanning when the message was a badwords command itself;
 *   that guard cannot be replicated in onChat without the prefix value.
 *   Impact: if an admin types the command with a bad word in the args the scanner
 *   will still run. In practice this is cosmetic — the admin is unlikely to be on
 *   two warnings already.
 *
 * ⚠️ GAP — kick-on-admin-grant flow:
 *   The original had a fallback that waited for the bot to receive admin rights and
 *   then kicked retroactively. Cat-Bot documents no equivalent event flow.
 *   `thread.removeUser()` is called directly; if it fails (no admin rights) the
 *   error is caught and reported in chat.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { kickRegistry } from '@/engine/lib/kick-registry.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'badwords',
  aliases: ['badword'] as string[],
  version: '1.4.0',
  role: Role.ANYONE, // per-subcommand admin gate is inside onCommand
  author: 'NTKhang (Cat-Bot port)',
  description: 'Manage and enforce a bad-words filter for this group.',
  category: 'Thread',
  usage: [
    'add <word[,word|word]> — Add banned word(s) (admin only)',
    'delete <word[,word|word]> — Remove banned word(s) (admin only)',
    'list [hide] — Show banned words',
    'on — Enable enforcement (admin only)',
    'off — Disable enforcement (admin only)',
    'unwarn [@mention | uid] — Remove one warning from a user (admin only)',
  ],
  cooldown: 5,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Masks the interior characters of a word, preserving first and last. */
function hideWord(str: string): string {
  if (str.length <= 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
}

/** Best-effort thread-admin check via thread.getInfo(). */
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

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Returns (and lazily creates) the 'badwords' collection handle for a thread.
 * All DB state lives here — words list, enabled flag, and per-user violations.
 */
async function getBadwordsHandle(db: AppCtx['db'], threadID: string) {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('badwords'))) {
    await coll.createCollection('badwords');
    // Initialise defaults on first creation
    const fresh = await coll.getCollection('badwords');
    await fresh.set('words', []);
    await fresh.set('enabled', false);
    await fresh.set('violations', {});
    return fresh;
  }
  return coll.getCollection('badwords');
}

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  thread,
  user,
  event,
  args,
  db,
  usage,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;
  const sub = args[0]?.toLowerCase();

  // Lazy-init the collection so every sub-command is guaranteed a valid handle
  const handle = await getBadwordsHandle(db, threadID);

  // ── add ────────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can add banned words to the list.',
      });
      return;
    }

    const rawInput = args.slice(1).join(' ').trim();
    if (!rawInput) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: "⚠️ You haven't entered the banned words.",
      });
      return;
    }

    const inputWords = rawInput
      .split(/[,|]/)
      .map((w) => w.trim())
      .filter(Boolean);
    const words = ((await handle.get('words')) as string[] | null) ?? [];

    const added: string[] = [];
    const duplicate: string[] = [];
    const tooShort: string[] = [];

    for (const word of inputWords) {
      if (word.length < 2) {
        tooShort.push(word);
      } else if (words.includes(word)) {
        duplicate.push(word);
      } else {
        words.push(word);
        added.push(word);
      }
    }

    await handle.set('words', words);

    const parts: string[] = [];
    if (added.length)
      parts.push(`✅ Added ${added.length} banned word(s) to the list.`);
    if (duplicate.length)
      parts.push(
        `❌ ${duplicate.length} word(s) already in the list: ${duplicate.map(hideWord).join(', ')}`,
      );
    if (tooShort.length)
      parts.push(
        `⚠️ ${tooShort.length} word(s) too short (< 2 chars): ${tooShort.join(', ')}`,
      );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: parts.join('\n') || '⚠️ No changes made.',
    });
    return;
  }

  // ── delete / del / -d ─────────────────────────────────────────────────────
  if (['delete', 'del', '-d'].includes(sub ?? '')) {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can delete banned words from the list.',
      });
      return;
    }

    const rawInput = args.slice(1).join(' ').trim();
    if (!rawInput) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: "⚠️ You haven't entered the words to delete.",
      });
      return;
    }

    const inputWords = rawInput
      .split(/[,|]/)
      .map((w) => w.trim())
      .filter(Boolean);
    const words = ((await handle.get('words')) as string[] | null) ?? [];

    const removed: string[] = [];
    const notFound: string[] = [];

    for (const word of inputWords) {
      const idx = words.indexOf(word);
      if (idx !== -1) {
        words.splice(idx, 1);
        removed.push(word);
      } else {
        notFound.push(word);
      }
    }

    await handle.set('words', words);

    const parts: string[] = [];
    if (removed.length)
      parts.push(`✅ Deleted ${removed.length} banned word(s) from the list.`);
    if (notFound.length)
      parts.push(
        `❌ ${notFound.length} word(s) not in the list: ${notFound.join(', ')}`,
      );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: parts.join('\n') || '⚠️ No changes made.',
    });
    return;
  }

  // ── list / all / -a ───────────────────────────────────────────────────────
  if (['list', 'all', '-a'].includes(sub ?? '')) {
    const words = ((await handle.get('words')) as string[] | null) ?? [];

    if (words.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ The list of banned words in your group is currently empty.',
      });
      return;
    }

    const display =
      args[1]?.toLowerCase() === 'hide'
        ? words.map(hideWord).join(', ')
        : words.join(', ');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `📑 Banned words in this group: ${display}`,
    });
    return;
  }

  // ── on ────────────────────────────────────────────────────────────────────
  if (sub === 'on') {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can enable this feature.',
      });
      return;
    }
    await handle.set('enabled', true);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ Banned words warning has been **enabled**.',
    });
    return;
  }

  // ── off ───────────────────────────────────────────────────────────────────
  if (sub === 'off') {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can disable this feature.',
      });
      return;
    }
    await handle.set('enabled', false);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ Banned words warning has been **disabled**.',
    });
    return;
  }

  // ── unwarn ────────────────────────────────────────────────────────────────
  if (sub === 'unwarn') {
    if (!(await isThreadAdmin(thread, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can remove banned-words warnings.',
      });
      return;
    }

    // Resolve target user: @mention → first mention key, else arg[1], else quoted reply sender
    const mentions =
      (event['mentions'] as Record<string, string> | undefined) ?? {};
    const mentionIDs = Object.keys(mentions);
    const replyEvent = event['messageReply'] as
      | Record<string, unknown>
      | undefined;

    let targetUID: string | undefined;
    if (mentionIDs[0]) targetUID = mentionIDs[0];
    else if (args[1]) targetUID = args[1];
    else if (replyEvent?.['senderID'])
      targetUID = replyEvent['senderID'] as string;

    if (!targetUID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: "⚠️ You haven't entered a user ID or tagged a user.",
      });
      return;
    }

    const violations =
      ((await handle.get('violations')) as Record<string, number> | null) ?? {};

    if (!violations[targetUID]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ User \`${targetUID}\` has not been warned for banned words.`,
      });
      return;
    }

    const current = violations[targetUID] ?? 0;
    if (current <= 1) {
      delete violations[targetUID];
    } else {
      violations[targetUID] = current - 1;
    }
    await handle.set('violations', violations);

    const userName = await user.getName(targetUID);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Removed 1 warning from **${userName}** (\`${targetUID}\`).`,
    });
    return;
  }

  // ── unrecognised subcommand ───────────────────────────────────────────────
  return usage();
};

// ── onChat ────────────────────────────────────────────────────────────────────
// Passive scanner — runs on every message in every thread.

export const onChat = async ({
  chat,
  thread,
  event,
  db,
}: AppCtx): Promise<void> => {
  const message = event['message'] as string | undefined;
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;

  if (!message) return;

  // Skip messages from thread admins — admins should not be kicked by their own filter
  if (await isThreadAdmin(thread, senderID)) return;

  // Read thread collection — lazy-init not needed here since we bail if not exist
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('badwords'))) return;

  const handle = await coll.getCollection('badwords');

  const enabled = (await handle.get('enabled')) as boolean | null;
  if (!enabled) return;

  const words = ((await handle.get('words')) as string[] | null) ?? [];
  if (words.length === 0) return;

  // Scan message for each banned word using whole-word matching
  for (const word of words) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(`\\b${word}\\b`, 'gi');
    } catch {
      // Fallback for words with special regex chars — simple includes check
      if (!message.toLowerCase().includes(word.toLowerCase())) continue;
      pattern = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    }

    if (!pattern.test(message)) continue;

    // Word found — check violation count
    const violations =
      ((await handle.get('violations')) as Record<string, number> | null) ?? {};
    const count = violations[senderID] ?? 0;

    if (count < 1) {
      // First offence — warn
      violations[senderID] = count + 1;
      await handle.set('violations', violations);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Banned word **"${word}"** detected in your message. If you continue to violate you will be kicked from the group.`,
      });
      return;
    } else {
      // Second offence — warn then kick
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Banned word **"${word}"** detected. You have violated 2 times and will be kicked from the group.`,
      });

      // Register the uid BEFORE removeUser() so the log:unsubscribe guard in
      // on-event.middleware.ts can suppress leave.ts's generic goodbye message.
      // The message above already owns the moderation narrative for this kick.
      kickRegistry.register(threadID, senderID);

      try {
        await thread.removeUser(senderID);
      } catch {
        // Bot lacks kick permission
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '⚠️ Bot needs admin privileges to kick this member.',
        });
      }

      // Reset violation count after kick so if re-added they start fresh
      delete violations[senderID];
      await handle.set('violations', violations);
      return;
    }
  }
};
