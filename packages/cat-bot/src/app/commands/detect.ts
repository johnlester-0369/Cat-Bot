/**
 * detect.ts — Upgraded keyword-detection command with persistent db.bot storage.
 *
 * ── Subcommands (BOT_ADMIN only) ─────────────────────────────────────────────
 *   detect add <word[,word|word]>  — Add target keyword(s)
 *   detect delete <word[,word|word]> — Remove target keyword(s)
 *   detect list [hide]             — List watched keywords (masks with * if 'hide')
 *   detect on                      — Enable passive detection for this session
 *   detect off                     — Disable passive detection for this session
 *   detect (no args)               — Show current status
 *
 * ── onChat (passive) ─────────────────────────────────────────────────────────
 *   Scans every incoming message when enabled. On a keyword match:
 *     • The sender is NEVER notified — no reply is posted in the chat.
 *     • Every registered bot admin receives a silent private DM alert with
 *       full context (platform, chat type, sender name, message content).
 *   Bot admins are excluded from triggering alerts to prevent self-floods.
 *
 * ── Storage (db.bot → 'detect_settings') ────────────────────────────────────
 *   words:   string[]  — managed keyword list (default: [])
 *   enabled: boolean   — session-wide detection toggle (default: false)
 *
 *   Storage is scoped to db.bot (session-level), mirroring the adminonly.ts /
 *   ignoreonlyad.ts pattern — keywords are shared across all threads of the
 *   current bot session rather than being per-thread.
 *
 * ── Chat-type taxonomy per platform ──────────────────────────────────────────
 *   Platform            isGroup=true          isGroup=false
 *   ─────────────────   ──────────────────    ─────────────────
 *   Discord             Server Channel        Direct Message
 *   Telegram            Group / Supergroup    Private Chat
 *   Facebook Messenger  Group Chat            Direct Message
 *
 * ── category: 'Hidden' ───────────────────────────────────────────────────────
 *   'Hidden' is filtered by help.ts before any output is rendered — this
 *   command is invisible on every platform regardless of the caller's role.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { listBotAdmins } from '@/engine/repos/credentials.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'detect',
  aliases: [] as string[],
  version: '2.0.0',
  role: Role.BOT_ADMIN,
  author: 'AjiroDesu',
  description:
    'Manage a persistent keyword watch-list and silently notify bot admins via DM on match.',
  category: 'Hidden',
  usage: [
    'add <word[,word|word]> — Add target word(s) (bot admin only)',
    'delete <word[,word|word]> — Remove target word(s)',
    'list [hide] — Show watched keywords',
    'on — Enable detection for this session',
    'off — Disable detection for this session',
  ],
  cooldown: 3,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escape MarkdownV2 special characters so raw user text can never break the
 * formatted alert (e.g. a message containing "_word_" would otherwise close
 * an italic span mid-report).
 */
function escapeMd(text: string): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Build a whole-word, case-insensitive RegExp for a keyword.
 * Returns null when the keyword contains regex-unsafe characters — callers
 * fall back to a plain case-insensitive substring search in that case.
 */
function makePattern(kw: string): RegExp | null {
  try {
    return new RegExp(`\\b${kw}\\b`, 'i');
  } catch {
    return null;
  }
}

/**
 * Masks the interior characters of a word, preserving first and last.
 * e.g. "example" → "e*****e"
 */
function hideWord(str: string): string {
  if (str.length <= 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
}

/**
 * Returns a human-readable chat type string that accurately reflects the
 * source context: Discord server channels are labelled differently from DMs,
 * Telegram groups from private chats, and so on.
 */
function resolveChatType(platform: string, isGroup: boolean): string {
  switch (platform) {
    case Platforms.Discord:
      return isGroup ? 'Server Channel' : 'Direct Message';
    case Platforms.Telegram:
      return isGroup ? 'Group / Supergroup' : 'Private Chat';
    case Platforms.FacebookMessenger:
      return isGroup ? 'Group Chat' : 'Direct Message';
    default:
      return isGroup ? 'Group' : 'Private Chat';
  }
}

// ── DB helper ─────────────────────────────────────────────────────────────────

/**
 * Returns (and lazily creates) the 'detect_settings' collection in db.bot.
 * Scoped to the current bot session — mirrors the adminonly.ts / ignoreonlyad.ts
 * pattern so keywords persist across all threads without per-thread overhead.
 *
 * Default schema on first creation:
 *   { words: [], enabled: false }
 */
async function getDetectHandle(db: AppCtx['db']) {
  const coll = db.bot;
  if (!(await coll.isCollectionExist('detect_settings'))) {
    await coll.createCollection('detect_settings');
    const fresh = await coll.getCollection('detect_settings');
    await fresh.set('words', []);
    await fresh.set('enabled', false);
    return fresh;
  }
  return coll.getCollection('detect_settings');
}

// ── onCommand — subcommand router (BOT_ADMIN gated by config.role) ────────────

export const onCommand = async ({
  chat,
  args,
  db,
  usage,
}: AppCtx): Promise<void> => {
  const sub = args[0]?.toLowerCase();
  const handle = await getDetectHandle(db);

  // ── add ──────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    const rawInput = args.slice(1).join(' ').trim();
    if (!rawInput) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: "⚠️ You haven't entered any keywords to add.",
      });
      return;
    }

    const inputWords = rawInput
      .split(/[,|]/)
      .map((w) => w.trim().toLowerCase())
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
      parts.push(`✅ Added ${added.length} keyword(s) to the watch-list.`);
    if (duplicate.length)
      parts.push(
        `❌ ${duplicate.length} keyword(s) already in the list: ${duplicate.map(hideWord).join(', ')}`,
      );
    if (tooShort.length)
      parts.push(
        `⚠️ ${tooShort.length} keyword(s) too short (< 2 chars): ${tooShort.join(', ')}`,
      );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: parts.join('\n') || '⚠️ No changes made.',
    });
    return;
  }

  // ── delete / del / -d ────────────────────────────────────────────────────
  if (['delete', 'del', '-d'].includes(sub ?? '')) {
    const rawInput = args.slice(1).join(' ').trim();
    if (!rawInput) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: "⚠️ You haven't entered any keywords to delete.",
      });
      return;
    }

    const inputWords = rawInput
      .split(/[,|]/)
      .map((w) => w.trim().toLowerCase())
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
      parts.push(
        `✅ Deleted ${removed.length} keyword(s) from the watch-list.`,
      );
    if (notFound.length)
      parts.push(
        `❌ ${notFound.length} keyword(s) not found in the list: ${notFound.join(', ')}`,
      );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: parts.join('\n') || '⚠️ No changes made.',
    });
    return;
  }

  // ── list / all / -a ──────────────────────────────────────────────────────
  if (['list', 'all', '-a'].includes(sub ?? '')) {
    const words = ((await handle.get('words')) as string[] | null) ?? [];

    if (words.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ The keyword watch-list is currently empty.',
      });
      return;
    }

    const display =
      args[1]?.toLowerCase() === 'hide'
        ? words.map(hideWord).join(', ')
        : words.join(', ');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `📑 **Watched keywords** (${words.length}): ${display}`,
    });
    return;
  }

  // ── on ────────────────────────────────────────────────────────────────────
  if (sub === 'on') {
    await handle.set('enabled', true);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ Keyword detection has been **enabled** for this session.',
    });
    return;
  }

  // ── off ───────────────────────────────────────────────────────────────────
  if (sub === 'off') {
    await handle.set('enabled', false);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ Keyword detection has been **disabled** for this session.',
    });
    return;
  }

  // ── status (no args) ──────────────────────────────────────────────────────
  if (!sub) {
    const words = ((await handle.get('words')) as string[] | null) ?? [];
    const enabled = (await handle.get('enabled')) as boolean | null;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `🛡️ **Detection System — Status**\n\n` +
        `• State: ${enabled ? '🟢 **Online**' : '🔴 **Offline**'}\n` +
        `• Keywords watched: **${words.length}**\n` +
        (words.length > 0
          ? `• List: _${words.map(escapeMd).join(', ')}_`
          : '• List: _(empty)_'),
    });
    return;
  }

  // ── unrecognised subcommand ───────────────────────────────────────────────
  return usage();
};

// ── onChat — passive keyword scanner ─────────────────────────────────────────
//
// Runs on EVERY incoming message across all threads and platforms when enabled.
// The sender is NEVER notified — no message is posted in the source chat.
// Only bot admins receive a private DM alert with full context.

export const onChat = async ({
  event,
  chat,
  native,
  user,
  db,
}: AppCtx): Promise<void> => {
  // ── 1. Guard: message text required ────────────────────────────────────────
  const message = event['message'] as string | undefined;
  if (!message?.trim()) return;

  const senderID = event['senderID'] as string | undefined;
  if (!senderID) return;

  // ── 2. Guard: session identity required for admin lookups ──────────────────
  const { userId, platform, sessionId } = native;
  if (!userId || !platform || !sessionId) {
    console.error('[detect] Missing session identity — skipping.');
    return;
  }

  // ── 3. Check detection is enabled ─────────────────────────────────────────
  // Bail early before any admin/DB work if the feature is toggled off.
  const handle = await getDetectHandle(db);
  const enabled = (await handle.get('enabled')) as boolean | null;
  if (!enabled) return;

  // ── 4. Load the keyword list ───────────────────────────────────────────────
  const words = ((await handle.get('words')) as string[] | null) ?? [];
  if (words.length === 0) return;

  // ── 5. Fetch admin list and exclude admins from triggering alerts ──────────
  // Prevents a bot admin from accidentally flooding themselves with reports
  // when they type a monitored keyword.
  let adminIds: string[] = [];
  try {
    adminIds = await listBotAdmins(userId, platform, sessionId);
  } catch (err) {
    console.error('[detect] Failed to fetch admin list:', (err as Error).message);
    return;
  }

  // Bot admins are silently excluded — they never see an alert about themselves.
  if (adminIds.includes(senderID)) return;

  // ── 6. Keyword matching (whole-word, case-insensitive) ─────────────────────
  // Build patterns on demand (not cached globally since the list is now dynamic).
  const detected = words.filter((kw) => {
    const pattern = makePattern(kw);
    return pattern
      ? pattern.test(message)
      : message.toLowerCase().includes(kw.toLowerCase());
  });

  if (!detected.length) return;

  // ── 7. Resolve display context ─────────────────────────────────────────────
  const threadID  = (event['threadID']  as string) || 'Unknown';
  const messageID = (event['messageID'] as string) || 'N/A';
  const isGroup   = (event['isGroup']   as boolean) ?? false;

  // Resolve human-readable names — both are best-effort; fall back to raw IDs
  // on failure so a single lookup error never silences the entire alert.
  let senderName = senderID;
  try {
    const resolved = await user.getName(senderID);
    if (resolved) senderName = resolved;
  } catch {
    // Proceed with raw ID
  }

  let threadName = threadID;
  if (isGroup) {
    try {
      const resolved = await db.threads.getName(threadID);
      if (resolved) threadName = resolved;
    } catch {
      // Proceed with raw ID
    }
  }

  // ── 8. Build chat-type label and alert report ──────────────────────────────
  const chatType = resolveChatType(platform, isGroup);
  const keywords = detected.map((k) => `\`${k}\``).join(', ');
  const safeBody = escapeMd(message);

  // Group / channel lines (threadName, threadID) are only shown when isGroup
  // is true — a DM has no meaningful "chat name" beyond the sender themselves.
  const chatSection = isGroup
    ? `*Chat Details:*\n` +
      `• Type: ${chatType}\n` +
      `• Name: **${escapeMd(threadName)}**\n` +
      `• ID: \`${threadID}\``
    : `*Chat Details:*\n` +
      `• Type: ${chatType}\n` +
      `• ID: \`${threadID}\``;

  const report =
    `🚨 *Keyword Detected: ${keywords}*\n\n` +
    `${chatSection}\n\n` +
    `*Sender Details:*\n` +
    `• Name: **${escapeMd(senderName)}**\n` +
    `• ID: \`${senderID}\`\n\n` +
    `*Message Details:*\n` +
    `• Message ID: \`${messageID}\`\n` +
    `• Platform: ${platform}\n` +
    `• Content:\n\n` +
    `_${safeBody}_`;

  // ── 9. DM every bot admin — sender is NEVER notified ──────────────────────
  // chat.reply() with thread_id set to the admin's user ID targets their 1-on-1
  // DM thread — the same pattern used by sendnoti.ts for group broadcasts.
  // No message is ever posted back into the source chat or to the sender.
  if (!adminIds.length) return;

  for (const adminId of adminIds) {
    try {
      await chat.reply({
        thread_id: adminId,
        style: MessageStyle.MARKDOWN,
        message: report,
      });
    } catch (err) {
      console.error(
        `[detect] Failed to DM admin ${adminId}:`,
        (err as Error).message,
      );
    }
  }
};