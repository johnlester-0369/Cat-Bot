/**
 * /balance — Coin Balance Viewer
 *
 * Displays the current coin balance for the calling user, or for each
 * @mentioned user. Coins accumulate via /daily (and any future economy
 * commands) which write to the 'money' collection on bot_users_session.data.
 *
 * Collection schema (bot_users_session.data → "money" key):
 *   {
 *     coins:     number   — total accumulated coins
 *     lastClaim: number   — Unix timestamp (ms) of the most recent /daily claim
 *     streak:    number   — consecutive days claimed
 *   }
 *
 * Mention path: when @mentions are present the command shows a balance line for
 * each mentioned user — mirrors the GoatBot/Mirai multi-user balance pattern.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'balance',
  aliases: ['bal'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'View your coin balance, or the balance of a @mentioned user',
  category: 'Economy',
  usage: '[@mention]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.user,
      name: 'user',
      description: 'User to view balance',
      required: false,
    },
  ],
};

/**
 * Reads the accumulated coin balance for a single platform user ID.
 * Returns 0 when the user has never claimed /daily — avoids throwing on absent
 * collections instead of surfacing an unhandled rejection to the handler.
 */
async function getCoins(db: AppCtx['db'], uid: string): Promise<number> {
  const userColl = db.users.collection(uid);
  if (!(await userColl.isCollectionExist('money'))) return 0;
  const money = await userColl.getCollection('money');
  const val = (await money.get('coins')) as number | undefined;
  return val ?? 0;
}

export const onCommand = async ({ chat, event, db }: AppCtx): Promise<void> => {
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});

  // ── Mentioned users ───────────────────────────────────────────────────────
  // When @mentions are present, show each user's balance in a single reply so
  // group members can compare coin totals without issuing separate commands.
  if (mentionIDs.length > 0) {
    const lines: string[] = [];
    for (const uid of mentionIDs) {
      // Platforms embed '@' in the mention display name — strip it for cleaner output
      const displayName = (mentions?.[uid] ?? uid).replace(/^@/, '');
      const coins = await getCoins(db, uid);
      lines.push(`**${displayName}:** ${coins.toLocaleString()} coins`);
    }
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines.join('\n'),
    });
    return;
  }

  // ── Sender's own balance ──────────────────────────────────────────────────
  const senderID = event['senderID'] as string | undefined;
  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  const coins = await getCoins(db, senderID);
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `💰 **Your balance:** ${coins.toLocaleString()} coins`,
  });
};
