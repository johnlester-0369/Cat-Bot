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
 *   Passively scans every GROUP message when enforcement is enabled.
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
 *   error is caught, reported in chat, and the violation count is PRESERVED so the
 *   kick will re-trigger on the user's next offending message.
 *
 * FIXES in this version (v1.4.1):
 *   [BUG-1] onChat: missing isGroup guard — scanner now skips DM/private threads.
 *   [BUG-2] onChat: violations were cleared even when removeUser() failed — the
 *           delete + save are now inside the try block (only on successful kick).
 *   [BUG-3] onChat: violations were fetched inside the word-scan loop causing
 *           redundant DB reads; now loaded once before scanning begins.
 *   [BUG-4] onChat: non-message event types (reactions, unsends) could reach the
 *           scanner; now guarded with an explicit type check.
 *   [IMPROVE] getBadwordsHandle: added explicit await on the return path.
 *   [IMPROVE] Word boundary matching: Unicode-aware regex using lookahead/lookbehind
 *             so non-ASCII words (Tagalog, accented chars, etc.) are detected
 *             correctly on Facebook Messenger and Telegram.
 *   [IMPROVE] user.getName wrapped in try/catch in the unwarn subcommand so a
 *             missing/deleted user does not crash the handler.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { kickRegistry } from '@/engine/lib/kick-registry.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'badwords',
  aliases: ['badword'] as string[],
  version: '1.4.1',
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
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'Subcommand: add, delete, list, on, off, unwarn',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'value',
      description: 'Word(s) or user to act on (context-dependent)',
      required: false,
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Masks the interior characters of a word, preserving first and last. */
function hideWord(str: string): string {
  if (str.length <= 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
}

/**
 * Builds a Unicode-aware word-boundary regex for the given word.
 *
 * JavaScript's `\b` only recognises ASCII word chars [A-Za-z0-9_], so it
 * silently fails for accented characters and non-Latin scripts (Tagalog, etc.).
 * We use lookahead/lookbehind against a broad Unicode letter/digit class instead.
 *
 * Falls back to a plain escaped-substring match if the browser/engine does not
 * support Unicode property escapes (\p{L}).
 *
 * [FIX-IMPROVE] Replaces the original \b-based approach.
 */
function buildWordPattern(word: string): RegExp {
  // Escape any regex special characters inside the word itself
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    // Unicode-aware boundary: not preceded/followed by a Unicode letter or digit
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
  } catch {
    // Fallback for runtimes without Unicode property escape support
    try {
      return new RegExp(`(?<![A-Za-z0-9À-ÖØ-öø-ÿ])${escaped}(?![A-Za-z0-9À-ÖØ-öø-ÿ])`, 'gi');
    } catch {
      // Last resort: simple case-insensitive search (no boundary)
      return new RegExp(escaped, 'gi');
    }
  }
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

/**
 * Returns true if the sender is a thread admin, bot admin, OR system admin.
 * This is the preferred gate for moderation subcommands — it grants full access
 * to privileged bot/system roles without requiring them to be group admins.
 */
async function isPrivilegedUser(
  thread: AppCtx['thread'],
  native: AppCtx['native'],
  senderID: string,
): Promise<boolean> {
  if (await isSystemAdmin(senderID)) return true;
  const { userId, platform, sessionId } = native;
  if (userId && platform && sessionId) {
    if (await isBotAdmin(userId, platform, sessionId, senderID)) return true;
  }
  return isThreadAdmin(thread, senderID);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Returns (and lazily creates) the 'badwords' collection handle for a thread.
 * All DB state lives here — words list, enabled flag, and per-user violations.
 *
 * [FIX-IMPROVE] Added explicit `await` on the existing-collection return path.
 */
async function getBadwordsHandle(db: AppCtx['db'], threadID: string) {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('badwords'))) {
    await coll.createCollection('badwords');
    const fresh = await coll.getCollection('badwords');
    await fresh.set('words', []);
    await fresh.set('enabled', false);
    await fresh.set('violations', {});
    return fresh;
  }
  // [FIX-IMPROVE] await is explicit to match the async return type
  return await coll.getCollection('badwords');
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
  native,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;
  const sub = args[0]?.toLowerCase();

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  // Lazy-init the collection so every sub-command is guaranteed a valid handle
  const handle = await getBadwordsHandle(db, threadID);

  // ── add ────────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    if (!(await isPrivilegedUser(thread, native, senderID))) {
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
    if (!(await isPrivilegedUser(thread, native, senderID))) {
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
    if (!(await isPrivilegedUser(thread, native, senderID))) {
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
    if (!(await isPrivilegedUser(thread, native, senderID))) {
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
    if (!(await isPrivilegedUser(thread, native, senderID))) {
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

    // [FIX-IMPROVE] Wrapped in try/catch: getName may fail if the user left the group.
    let userName: string;
    try {
      userName = await user.getName(targetUID);
    } catch {
      userName = targetUID;
    }

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
  native,
}: AppCtx): Promise<void> => {
  // [BUG-1 FIX] Guard: only enforce in group threads.
  // Without this check the scanner fires in DMs, causing spurious warnings
  // and failed removeUser() calls on every platform (Discord, Telegram, Messenger).
  if (!event['isGroup']) return;

  // [BUG-4 FIX] Guard: only handle plain text messages and message replies.
  // Reactions, unsend notifications, and log events can reach onChat; they
  // carry no body text and must be skipped before any DB access.
  const eventType = event['type'] as string | undefined;
  if (eventType && eventType !== 'message' && eventType !== 'message_reply') return;

  const message = event['message'] as string | undefined;
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;

  if (!message || !message.trim()) return;

  // Skip messages from thread admins, bot admins, or system admins
  if (await isPrivilegedUser(thread, native, senderID)) return;

  // Read thread collection — lazy-init not needed here; bail if not yet created
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('badwords'))) return;

  const handle = await coll.getCollection('badwords');

  const enabled = (await handle.get('enabled')) as boolean | null;
  if (!enabled) return;

  const words = ((await handle.get('words')) as string[] | null) ?? [];
  if (words.length === 0) return;

  // [BUG-3 FIX] Load violations ONCE before the loop.
  // Previously this was fetched inside the loop, causing a redundant DB read
  // for every word in the list even when no match was found.
  const violations =
    ((await handle.get('violations')) as Record<string, number> | null) ?? {};
  const count = violations[senderID] ?? 0;

  // Scan message for each banned word using Unicode-aware whole-word matching
  for (const word of words) {
    const pattern = buildWordPattern(word);

    if (!pattern.test(message)) continue;

    // ── Word found ────────────────────────────────────────────────────────

    if (count < 1) {
      // First offence — warn and persist the incremented count
      violations[senderID] = count + 1;
      await handle.set('violations', violations);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Banned word detected in your message. If you continue to violate you will be kicked from the group.`,
      });
      return;
    }

    // Second (or more) offence — warn, attempt kick, then conditionally reset
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Banned word detected. You have violated ${count + 1} time(s) and will be kicked from the group.`,
    });

    // Register the uid BEFORE removeUser() so on-event.middleware.ts can suppress
    // the generic leave.ts goodbye message for this moderation kick.
    kickRegistry.register(threadID, senderID);

    let kickSucceeded = false;
    try {
      await thread.removeUser(senderID);
      kickSucceeded = true;
    } catch {
      // Bot lacks kick permission — inform the group but keep the violation so
      // the next offending message triggers another kick attempt.
      // [BUG-2 FIX] violations are NOT cleared here; they are only cleared below
      // when kickSucceeded is true.
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Bot needs admin privileges to kick this member. Violation count has been preserved.',
      });
      // Note: the kickRegistry entry registered above will auto-expire after its
      // built-in TTL (30 s) without being consumed, so no cleanup call is needed.
    }

    // [BUG-2 FIX] Only reset the violation count if the kick actually succeeded.
    // Previously, `delete violations[senderID]` ran unconditionally (outside
    // the try/catch), so a failed kick still cleared the user's warning count,
    // letting them start over with a fresh warning instead of being kicked again.
    if (kickSucceeded) {
      delete violations[senderID];
      await handle.set('violations', violations);
    }

    return;
  }
};