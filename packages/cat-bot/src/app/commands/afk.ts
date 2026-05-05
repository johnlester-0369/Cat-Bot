/**
 * /afk — Away From Keyboard Command
 *
 * Marks the sender as AFK with an optional reason. The status is
 * automatically cleared the next time the user sends any message.
 *
 * Behaviours:
 *   /afk [reason]   — set AFK (or toggle it off if already AFK)
 *   Any message     — auto-clears AFK and announces the user is back
 *   @mention AFK    — notifies the mentioner that the tagged user is AFK
 *
 * Platform notes:
 *   - Facebook Page: EXCLUDED (page posts are not user-level conversations)
 *   - Telegram: two-layer mention detection (see §Telegram mention resolution below)
 *
 * ── Telegram mention resolution ───────────────────────────────────────────────
 * Telegram has two distinct entity types for mentions:
 *
 *   text_mention  — user has NO public username, or was mentioned via the
 *                   contact picker. The Bot API delivers their numeric user ID.
 *                   event['mentions'] key → numeric ID string → standard path.
 *
 *   mention       — user WAS mentioned by typing @username. The Bot API only
 *                   delivers the raw handle string, NOT the numeric ID.
 *                   event['mentions'] key → "@username" string → ID unknown.
 *
 * To handle the second case, the AFK collection stores `telegramUsername` at
 * set-time (from native.ctx.from.username). On every onChat call we:
 *   1. Check all mention keys that start with "@" against stored usernames.
 *   2. Scan every word in the raw message body (with or without leading "@")
 *      against stored usernames — catches bare "username" without @ too.
 * Both scans call db.users.getAll() once and share the result to avoid
 * redundant DB reads.
 *
 * Collection schema (stored under "afk" key in bot_users_session.data):
 *   {
 *     active:           boolean  — true while AFK; cleared (→ {}) on return
 *     reason:           string   — shown to users who mention the AFK person
 *     since:            number   — Unix timestamp (ms) when AFK was set
 *     telegramUsername: string   — Telegram @handle without "@"; null on other platforms
 *   }
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'afk',
  aliases: ['away'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Mark yourself as AFK with an optional reason. Auto-clears when you next send a message.',
  category: 'utility',
  usage: [
    '[reason] — go AFK with an optional reason',
    '— run again while AFK to manually clear your status',
  ],
  cooldown: 5,
  hasPrefix: true,
  // Facebook Page posts are not user-level conversations — AFK has no meaningful
  // context there (no real-time replies, no persistent user identities per message).
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts elapsed milliseconds into a human-readable string: "2h 14m", "45m", "30s". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Shape of data stored inside the "afk" collection. */
interface AfkRecord {
  reason: string;
  since: number;
  telegramUsername: string | null;
}

/**
 * Returns the AFK record if the user currently has an active AFK status,
 * otherwise null. Gates on `active === true` so a cleared collection (→ {})
 * is treated identically to a collection that was never created.
 */
async function getAfkStatus(
  db: AppCtx['db'],
  userID: string,
): Promise<AfkRecord | null> {
  const userColl = db.users.collection(userID);
  if (!(await userColl.isCollectionExist('afk'))) return null;

  const afkData = await userColl.getCollection('afk');
  const active = (await afkData.get('active')) as boolean | undefined;
  if (!active) return null;

  return {
    reason:
      ((await afkData.get('reason')) as string | undefined) ??
      'No reason provided',
    since: ((await afkData.get('since')) as number | undefined) ?? Date.now(),
    telegramUsername:
      ((await afkData.get('telegramUsername')) as string | null | undefined) ??
      null,
  };
}

/**
 * Resets a user's AFK collection to {}, making `active` undefined on the next read.
 * Uses clear() because CollectionManager has no deleteCollection method.
 */
async function clearAfkStatus(db: AppCtx['db'], userID: string): Promise<void> {
  const userColl = db.users.collection(userID);
  if (!(await userColl.isCollectionExist('afk'))) return;
  const afkData = await userColl.getCollection('afk');
  await afkData.clear();
}

// ── onCommand — set or toggle off AFK ────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  args,
  db,
  native,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;
  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  // ── Already AFK → remove and report duration ──────────────────────────────
  const existing = await getAfkStatus(db, senderID);
  if (existing) {
    const duration = formatDuration(Date.now() - existing.since);
    await clearAfkStatus(db, senderID);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        '👋 Welcome back! Your AFK status has been cleared.',
        `⏱️ You were away for **${duration}**.`,
      ].join('\n'),
    });
    return;
  }

  // ── Not AFK → set AFK ─────────────────────────────────────────────────────
  const reason = args.join(' ').trim() || 'No reason provided';
  const now = Date.now();

  // Capture Telegram @username at set-time so mention-by-handle and bare-username
  // checks in onChat can resolve this user even when the Bot API only delivers a
  // handle string (mention entity) rather than a numeric ID (text_mention entity).
  // native.ctx is a raw Telegraf Context on Telegram; undefined on other platforms.
  const telegramUsername =
    native.platform === Platforms.Telegram
      ? ((native.ctx as { from?: { username?: string } } | undefined)?.from
          ?.username ?? null)
      : null;

  const userColl = db.users.collection(senderID);
  if (!(await userColl.isCollectionExist('afk'))) {
    await userColl.createCollection('afk');
  }

  const afkData = await userColl.getCollection('afk');
  await afkData.set('active', true);
  await afkData.set('reason', reason);
  await afkData.set('since', now);
  await afkData.set('telegramUsername', telegramUsername);

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `💤 You are now **AFK**.`,
      `📝 Reason: *${reason}*`,
      ``,
      `Your status will be cleared automatically when you next send a message.`,
    ].join('\n'),
  });
};

// ── onChat — auto-clear on send; notify on @mention or username match ─────────
//
// Fires on every incoming message. Runs three checks in order:
//
//   [1] Is the SENDER currently AFK?
//       → remove status, announce they're back.
//
//   [2a] Standard: numeric mention IDs in event['mentions']
//        → text_mention (Telegram) or native mentions (Discord/FB Messenger).
//        → look up each ID's AFK status directly via the collection API.
//
//   [2b] Telegram: "@username" mention keys in event['mentions']
//        → the Bot API only gives a handle string (mention entity), no numeric ID.
//        → compare normalised handle against every AFK user's stored telegramUsername.
//
//   [3]  Telegram: bare-word scan of the raw message body
//        → catches "hey username" and "hey @username" without a formal entity.
//        → compare each body word (stripped of any leading "@") against stored usernames.
//
// Checks [2b] and [3] share a single db.users.getAll() call to avoid redundant DB
// reads. A Set of already-notified user IDs prevents duplicate notices.

export const onChat = async ({
  chat,
  event,
  db,
  native,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;
  if (!senderID) return;

  const isTelegram = native.platform === Platforms.Telegram;

  // ── [1] Auto-clear sender's own AFK ───────────────────────────────────────
  const senderAfk = await getAfkStatus(db, senderID);
  if (senderAfk) {
    const duration = formatDuration(Date.now() - senderAfk.since);
    await clearAfkStatus(db, senderID);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        '👋 Welcome back! Your AFK status has been cleared.',
        `⏱️ You were away for **${duration}**.`,
      ].join('\n'),
    });
  }

  // ── Prepare mention data ───────────────────────────────────────────────────
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionKeys = Object.keys(mentions ?? {});

  // Split mention keys into:
  //   numericMentionIDs      — pure numeric strings → text_mention / Discord / FB (have real user IDs)
  //   usernameMentionHandles — start with "@"       → Telegram mention entity (no numeric ID)
  const numericMentionIDs = mentionKeys.filter((k) => !k.startsWith('@'));
  const usernameMentionHandles = mentionKeys
    .filter((k) => k.startsWith('@'))
    .map((k) => k.slice(1).toLowerCase()); // strip "@" for case-insensitive comparison

  // Telegram body scan: normalise every word by stripping a leading "@".
  // This allows matching both "@handle" and "handle" typed inline without an entity.
  const msgBody = (event['message'] as string | undefined) ?? '';
  const bodyWords = isTelegram
    ? msgBody
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.replace(/^@/, '').toLowerCase())
    : [];

  // Only call the expensive getAll() when Telegram has username handles or body words to match.
  const needsFullScan =
    isTelegram && (usernameMentionHandles.length > 0 || bodyWords.length > 0);

  const allUsers = needsFullScan ? await db.users.getAll() : [];

  const afkNotices: string[] = [];
  const notifiedIDs = new Set<string>(); // dedup across all three check paths

  // ── [2a] Standard numeric mention lookup ──────────────────────────────────
  for (const uid of numericMentionIDs) {
    if (uid === senderID || notifiedIDs.has(uid)) continue;

    const afk = await getAfkStatus(db, uid);
    if (!afk) continue;

    const displayName = (mentions?.[uid] ?? uid).replace(/^@/, '');
    const duration = formatDuration(Date.now() - afk.since);

    afkNotices.push(
      [
        `💤 **${displayName}** is currently AFK.`,
        `📝 Reason: *${afk.reason}*`,
        `⏱️ Away for: **${duration}**`,
      ].join('\n'),
    );
    notifiedIDs.add(uid);
  }

  // ── [2b] & [3] Telegram username handle + bare body word scan ─────────────
  // Both checks iterate the same allUsers snapshot in one pass to minimise DB work.
  if (needsFullScan) {
    for (const { botUserId, data } of allUsers) {
      if (botUserId === senderID || notifiedIDs.has(botUserId)) continue;

      // Read the AFK record directly from the raw data blob — avoids a per-user
      // getCollection() round-trip since we already have the full data snapshot.
      const raw = data['afk'] as Record<string, unknown> | undefined;
      if (!raw?.active) continue;

      const storedUsername = raw['telegramUsername'] as
        | string
        | null
        | undefined;
      if (!storedUsername) continue; // user has no Telegram username stored

      const normalizedStored = storedUsername.toLowerCase();

      // [2b] @username mention entity — typed as @handle in chat
      const matchedByHandle = usernameMentionHandles.includes(normalizedStored);

      // [3] Bare word in message body — typed inline without a formal entity
      // Only check when [2b] didn't already match to avoid double-adding.
      const matchedByBody =
        !matchedByHandle && bodyWords.includes(normalizedStored);

      if (!matchedByHandle && !matchedByBody) continue;

      const reason =
        (raw['reason'] as string | undefined) ?? 'No reason provided';
      const since = (raw['since'] as number | undefined) ?? Date.now();
      const duration = formatDuration(Date.now() - since);

      // Use the stored @handle as display name — first name is unavailable here.
      afkNotices.push(
        [
          `💤 **@${storedUsername}** is currently AFK.`,
          `📝 Reason: *${reason}*`,
          `⏱️ Away for: **${duration}**`,
        ].join('\n'),
      );
      notifiedIDs.add(botUserId);
    }
  }

  if (afkNotices.length > 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: afkNotices.join('\n\n'),
    });
  }
};
