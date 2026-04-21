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
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
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

const BUTTON_ID = { daily_status: 'daily_status', back: 'back' } as const;

// Complement to /balance: shows when the daily claim resets so the user doesn't
// need to switch commands to check — closes the balance → daily economy loop.
export const button = {
  [BUTTON_ID.daily_status]: {
    label: '📅 Daily Status',
    style: ButtonStyle.SECONDARY,
    onClick: async ({
      chat,
      event,
      db,
      native,
      button,
      prefix = '',
    }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      // Back button stays visible after showing daily status so the user can return to balance
      const backId = button.generateID({ id: BUTTON_ID.back });
      if (!senderID) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: '❌ Could not identify your user ID on this platform.',
          ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
        });
        return;
      }
      const userColl = db.users.collection(senderID);
      if (!(await userColl.isCollectionExist('money'))) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: `📅 You haven't claimed \`${prefix}daily\` yet — your first reward is waiting!`,
          ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
        });
        return;
      }
      const money = await userColl.getCollection('money');
      const lastClaim = (await money.get('lastClaim')) as number | undefined;
      const COOLDOWN_MS = 24 * 60 * 60 * 1000;
      if (!lastClaim || Date.now() - lastClaim >= COOLDOWN_MS) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: `📅 Your daily reward is **ready**! Use \`${prefix}daily\` to claim.`,
          ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
        });
      } else {
        const remaining = COOLDOWN_MS - (Date.now() - lastClaim);
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor(
          (remaining % (1000 * 60 * 60)) / (1000 * 60),
        );
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: `⏰ Next daily claim in: **${hours}h ${minutes}m**`,
          ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
        });
      }
    },
  },
  // Returns to the coin balance view — closes the daily_status → balance navigation loop
  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

export const onCommand = async ({
  chat,
  event,
  currencies,
  native,
  button,
}: AppCtx): Promise<void> => {
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
      const coins = await currencies.getMoney(uid);
      lines.push(`**${displayName}:** ${coins.toLocaleString()} coins`);
    }
    // No button on the mention path — the balance is for the mentioned user, not the sender;
    // a daily_status button would check the SENDER's daily, which is confusing in context.
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

  const coins = await currencies.getMoney(senderID);
  // Edit when navigating back via the ⬅ Back button; reply for fresh /balance invocations
  const payload = {
    style: MessageStyle.MARKDOWN,
    message: `💰 **Your balance:** ${coins.toLocaleString()} coins`,
    // Only inject on the self-balance path — button checks the sender's daily, which is correct here.
    ...(hasNativeButtons(native.platform)
      ? { button: [button.generateID({ id: BUTTON_ID.daily_status })] }
      : {}),
  };
  if (event['type'] === 'button_action') {
    await chat.editMessage({
      ...payload,
      message_id_to_edit: event['messageID'] as string,
    });
  } else {
    await chat.replyMessage(payload);
  }
};
