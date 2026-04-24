/**
 * /setmoney — Direct Coin Balance Override (Bot Admin)
 *
 * Grants bot admins surgical control over any user's coin balance for economy
 * management: correcting duplicated daily rewards, granting prizes, resetting
 * abused balances — without needing to compute a delta manually.
 *
 * Sub-commands:
 *   setmoney me <amount>         — set own balance to an exact value
 *   setmoney del me              — reset own coins to 0 (preserves lastClaim/streak)
 *   setmoney del @mention        — reset a @mentioned user's coins to 0
 *   setmoney @mention <amount>   — set a @mentioned user's balance to an exact value
 *   setmoney uid <id> <amount>   — set balance by raw platform user ID
 *
 * Storage contract: writes to bot_users_session.data → 'money' → { coins: number }
 * This is the same key read by /balance's button handler (rank.ts line 97) and
 * by currencies.getMoney() — changes are immediately visible in /balance output.
 * Only the 'coins' key is touched; lastClaim and streak survive del operations so
 * daily cooldown state is preserved for the affected user.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'setmoney',
  aliases: [] as string[],
  version: '1.0.0',
  // BOT_ADMIN — direct coin mutation bypasses the earn-through-play contract;
  // lower privilege would let anyone print unlimited coins.
  role: Role.BOT_ADMIN,
  author: 'System',
  description:
    'Set the coin balance of yourself, a @mentioned user, or a user by ID',
  category: 'Admin',
  usage:
    'me <amount> | del me | del @mention | @mention <amount> | uid <id> <amount>',
  cooldown: 5,
  hasPrefix: true,
};

/**
 * Parses an integer coin amount from a raw argument slot.
 * Returns NaN when the slot is absent or non-numeric — callers check isNaN()
 * to prevent malformed input from silently writing 0 to someone's balance.
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

  // ── setmoney me <amount> ──────────────────────────────────────────────────
  // Self-targeting shorthand for bot admins granting themselves coins.
  if (sub === 'me') {
    const senderID = event['senderID'] as string | undefined;
    const amount = parseAmount(args[1]);

    if (!senderID || isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}setmoney me <amount>\``,
      });
      return;
    }

    const userColl = db.users.collection(senderID);
    if (!(await userColl.isCollectionExist('money'))) {
      await userColl.createCollection('money');
    }
    const money = await userColl.getCollection('money');
    // Write directly to the 'coins' key — the same key currencies.getMoney()
    // and /balance's button handler read — so the value is immediately consistent.
    await money.set('coins', amount);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Set your balance to **${amount.toLocaleString()}** coins.`,
    });
    return;
  }

  // ── setmoney del me | setmoney del @mention ───────────────────────────────
  // Zeros out only the 'coins' key — intentionally leaves lastClaim and streak
  // intact so the user's daily cooldown and streak data survive a balance wipe.
  if (sub === 'del') {
    const delTarget = args[1]?.toLowerCase();

    // setmoney del me
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
      if (!(await userColl.isCollectionExist('money'))) {
        await userColl.createCollection('money');
      }
      const money = await userColl.getCollection('money');
      // Capture current balance before wiping for an auditable confirmation message
      const raw = await money.get('coins');
      const currentCoins = typeof raw === 'number' ? raw : 0;
      await money.set('coins', 0);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          '✅ Removed all your coins.',
          `💸 Coins removed: **${currentCoins.toLocaleString()}**`,
        ].join('\n'),
      });
      return;
    }

    // setmoney del @mention
    if (mentionIDs.length === 1) {
      // Non-null assertion safe: length check above guarantees index 0 exists
      const mentionID = mentionIDs[0]!;
      const displayName = (mentions?.[mentionID] ?? mentionID).replace(
        /^@/,
        '',
      );

      const userColl = db.users.collection(mentionID);
      if (!(await userColl.isCollectionExist('money'))) {
        await userColl.createCollection('money');
      }
      const money = await userColl.getCollection('money');
      const raw = await money.get('coins');
      const currentCoins = typeof raw === 'number' ? raw : 0;
      await money.set('coins', 0);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          `✅ Removed all coins of **${displayName}**.`,
          `💸 Coins removed: **${currentCoins.toLocaleString()}**`,
        ].join('\n'),
      });
      return;
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Usage: \`${prefix}setmoney del me\` or \`${prefix}setmoney del @mention\``,
    });
    return;
  }

  // ── setmoney uid <id> <amount> ────────────────────────────────────────────
  // Platform-ID path for users who left the thread — their money row still
  // exists in bot_users_session and can be updated without an active @mention.
  if (sub === 'uid') {
    const targetID = args[1];
    const amount = parseAmount(args[2]);

    if (!targetID || isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}setmoney uid <id> <amount>\``,
      });
      return;
    }

    const name = await user.getName(targetID);
    const userColl = db.users.collection(targetID);
    if (!(await userColl.isCollectionExist('money'))) {
      await userColl.createCollection('money');
    }
    const money = await userColl.getCollection('money');
    await money.set('coins', amount);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Set balance of **${name}** to **${amount.toLocaleString()}** coins.`,
    });
    return;
  }

  // ── setmoney @mention <amount> ────────────────────────────────────────────
  // Amount is always the last token — the @mention string occupies earlier arg
  // slots depending on how the platform's parser serialises the mention text.
  if (mentionIDs.length === 1) {
    const mentionID = mentionIDs[0]!;
    const displayName = (mentions?.[mentionID] ?? mentionID).replace(/^@/, '');
    // args[args.length - 1] is string | undefined with noUncheckedIndexedAccess
    const amount = parseAmount(args[args.length - 1]);

    if (isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}setmoney @mention <amount>\``,
      });
      return;
    }

    const userColl = db.users.collection(mentionID);
    if (!(await userColl.isCollectionExist('money'))) {
      await userColl.createCollection('money');
    }
    const money = await userColl.getCollection('money');
    await money.set('coins', amount);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Set **${displayName}**'s balance to **${amount.toLocaleString()}** coins.`,
    });
    return;
  }

  // ── Fallback: no matching sub-command ────────────────────────────────────
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      '❌ Wrong syntax. Available sub-commands:',
      `\`${prefix}setmoney me <amount>\``,
      `\`${prefix}setmoney del me\``,
      `\`${prefix}setmoney del @mention\``,
      `\`${prefix}setmoney @mention <amount>\``,
      `\`${prefix}setmoney uid <id> <amount>\``,
    ].join('\n'),
  });
};
