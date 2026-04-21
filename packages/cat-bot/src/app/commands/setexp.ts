/**
 * /setexp — Direct EXP Override (Bot Admin)
 *
 * Grants bot admins surgical control over any user's EXP without waiting for
 * the passive rankup accumulation loop. Useful for correcting exploit-inflated
 * scores, granting manual bonuses, or resetting progression for moderation.
 *
 * Sub-commands:
 *   setexp me <amount>         — set own EXP to an exact value
 *   setexp del me              — reset own EXP to 0 (preserves xp collection)
 *   setexp del @mention        — reset a @mentioned user's EXP to 0
 *   setexp @mention <amount>   — set a @mentioned user's EXP to an exact value
 *   setexp uid <id> <amount>   — set EXP by raw platform user ID (works even
 *                                when the target user has left the thread)
 *
 * Storage contract: writes to bot_users_session.data → 'xp' → { exp: number }
 * This is the same collection read by /rank and written by /rankup onChat —
 * changes are immediately reflected in rank cards and level-up notifications.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'setexp',
  aliases: [] as string[],
  version: '1.0.0',
  // BOT_ADMIN — direct EXP mutation bypasses the passive accumulation contract;
  // exposing it at lower privilege levels would let anyone manipulate leaderboards.
  role: Role.BOT_ADMIN,
  author: 'System',
  description: 'Set the EXP of yourself, a @mentioned user, or a user by ID',
  category: 'Admin',
  usage: 'me <amount> | del me | del @mention | @mention <amount> | uid <id> <amount>',
  cooldown: 5,
  hasPrefix: true,
};

/**
 * Parses the last token in args as an integer EXP amount.
 * Returns NaN when the slot is absent or non-numeric — callers check isNaN()
 * before using the result so malformed input never silently sets EXP to 0.
 * Kept as a local helper to avoid repeating the undefined-guard pattern
 * at every sub-command branch (noUncheckedIndexedAccess makes args[N] = string | undefined).
 */
function parseAmount(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  return parseInt(raw, 10);
}

export const onCommand = async ({
  chat,
  event,
  args,
  db,
  user,
  prefix = '',
}: AppCtx): Promise<void> => {
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  const sub = args[0]?.toLowerCase();

  // ── setexp me <amount> ────────────────────────────────────────────────────
  // Self-targeting shorthand — bot admin corrects or grants their own EXP.
  if (sub === 'me') {
    const senderID = event['senderID'] as string | undefined;
    const amount = parseAmount(args[1]);

    if (!senderID || isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}setexp me <amount>\``,
      });
      return;
    }

    const userColl = db.users.collection(senderID);
    if (!(await userColl.isCollectionExist('xp'))) {
      await userColl.createCollection('xp');
    }
    const xpColl = await userColl.getCollection('xp');
    await xpColl.set('exp', amount);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Set your EXP to **${amount.toLocaleString()}**.`,
    });
    return;
  }

  // ── setexp del me | setexp del @mention ───────────────────────────────────
  // Hard reset to 0 — the xp collection row is preserved (not dropped) so future
  // passive increments from rankup onChat don't need to re-create the collection.
  if (sub === 'del') {
    const delTarget = args[1]?.toLowerCase();

    // setexp del me
    if (delTarget === 'me') {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '❌ Could not identify your user ID on this platform.',
        });
        return;
      }

      const userColl = db.users.collection(senderID);
      if (!(await userColl.isCollectionExist('xp'))) {
        await userColl.createCollection('xp');
      }
      const xpColl = await userColl.getCollection('xp');
      // Capture current EXP before wiping so the confirmation is auditable
      const raw = await xpColl.get('exp');
      const currentExp = typeof raw === 'number' ? raw : 0;
      await xpColl.set('exp', 0);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          '✅ Removed all your EXP.',
          `📊 EXP removed: **${currentExp.toLocaleString()}**`,
        ].join('\n'),
      });
      return;
    }

    // setexp del @mention
    if (mentionIDs.length === 1) {
      // Non-null assertion safe: length check above guarantees index 0 exists
      const mentionID = mentionIDs[0]!;
      const displayName = (mentions?.[mentionID] ?? mentionID).replace(/^@/, '');

      const userColl = db.users.collection(mentionID);
      if (!(await userColl.isCollectionExist('xp'))) {
        await userColl.createCollection('xp');
      }
      const xpColl = await userColl.getCollection('xp');
      const raw = await xpColl.get('exp');
      const currentExp = typeof raw === 'number' ? raw : 0;
      await xpColl.set('exp', 0);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          `✅ Removed all EXP of **${displayName}**.`,
          `📊 EXP removed: **${currentExp.toLocaleString()}**`,
        ].join('\n'),
      });
      return;
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Usage: \`${prefix}setexp del me\` or \`${prefix}setexp del @mention\``,
    });
    return;
  }

  // ── setexp uid <id> <amount> ──────────────────────────────────────────────
  // Targets a user by their raw platform ID — useful when the user has left the
  // thread and cannot be @mentioned, but their session row still exists in the DB.
  if (sub === 'uid') {
    const targetID = args[1];
    const amount = parseAmount(args[2]);

    if (!targetID || isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}setexp uid <id> <amount>\``,
      });
      return;
    }

    const name = await user.getName(targetID);
    const userColl = db.users.collection(targetID);
    if (!(await userColl.isCollectionExist('xp'))) {
      await userColl.createCollection('xp');
    }
    const xpColl = await userColl.getCollection('xp');
    await xpColl.set('exp', amount);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Set EXP of **${name}** to **${amount.toLocaleString()}**.`,
    });
    return;
  }

  // ── setexp @mention <amount> ──────────────────────────────────────────────
  // Amount is always the last token in the message — the @mention occupies
  // earlier arg slots depending on how the platform's parser serialises it.
  if (mentionIDs.length === 1) {
    const mentionID = mentionIDs[0]!;
    const displayName = (mentions?.[mentionID] ?? mentionID).replace(/^@/, '');
    // args[args.length - 1] is string | undefined with noUncheckedIndexedAccess;
    // parseAmount handles the undefined case by returning NaN.
    const amount = parseAmount(args[args.length - 1]);

    if (isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}setexp @mention <amount>\``,
      });
      return;
    }

    const userColl = db.users.collection(mentionID);
    if (!(await userColl.isCollectionExist('xp'))) {
      await userColl.createCollection('xp');
    }
    const xpColl = await userColl.getCollection('xp');
    await xpColl.set('exp', amount);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Set **${displayName}**'s EXP to **${amount.toLocaleString()}**.`,
    });
    return;
  }

  // ── Fallback: no matching sub-command ────────────────────────────────────
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      '❌ Wrong syntax. Available sub-commands:',
      `\`${prefix}setexp me <amount>\``,
      `\`${prefix}setexp del me\``,
      `\`${prefix}setexp del @mention\``,
      `\`${prefix}setexp @mention <amount>\``,
      `\`${prefix}setexp uid <id> <amount>\``,
    ].join('\n'),
  });
};