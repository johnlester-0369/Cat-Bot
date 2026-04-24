/**
 * /transfer — Coin Transfer Command
 *
 * Transfers a specified number of coins from the sender to a target user.
 * The target can be resolved from three sources (in priority order):
 *   1. A quoted/replied-to message  → target is the original sender
 *   2. An @mention in the command   → target is the first mentioned user
 *   3. A raw user ID as args[0]     → target is the supplied ID
 *
 * Coin amounts:
 *   - Reply path:   /transfer <amount>         (e.g. replying to a message + "100")
 *   - Mention path: /transfer @user <amount>   (e.g. "@user 100")
 *   - ID path:      /transfer <uid> <amount>   (e.g. "123456 100")
 *
 * Uses ctx.currencies for all balance reads and writes so no raw DB access is
 * needed — getMoney returns 0 for unknown users, decreaseMoney/increaseMoney
 * handle collection init automatically.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'transfer',
  aliases: ['tf'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Transfer coins to another user via reply, @mention, or user ID.',
  category: 'Economy',
  usage: '[@mention | uid] <amount>',
  guide: [
    '<reply to message> <amount>  — transfer to the quoted user',
    '<@mention> <amount>          — transfer to the mentioned user',
    '<uid> <amount>               — transfer to a user by ID',
  ],
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.user,
      name: 'user',
      description: 'Target user to send coins to',
      required: false,
    },
  ],
};

export const onCommand = async ({
  chat,
  event,
  args,
  currencies,
  user,
  usage,
}: AppCtx): Promise<void> => {
  // ── 1. Resolve target user ID ──────────────────────────────────────────────
  // Priority: Reply → @Mention → Raw ID arg
  // Track whether target came from a reply so we know which arg index holds the amount.

  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});

  let targetID: string | undefined;
  let isReplied = false;

  if (messageReply?.['senderID']) {
    // Target from reply — coin amount is args[0]
    targetID = messageReply['senderID'] as string;
    isReplied = true;
  } else if (mentionIDs.length > 0) {
    // Target from first @mention — coin amount is args[1] (args[0] = mention text)
    targetID = mentionIDs[0];
  } else if (args[0]) {
    // Target from raw user ID — coin amount is args[1]
    targetID = args[0];
  }

  // ── 2. Parse coin amount ───────────────────────────────────────────────────
  // Reply path uses args[0]; all other paths use args[1] since args[0] is the target token.
  const amountIndex = isReplied ? 0 : 1;
  const coinAmount = parseInt(args[amountIndex] ?? '', 10);

  // ── 3. Validate inputs ────────────────────────────────────────────────────
  if (!targetID || !coinAmount) {
    await usage();
    return;
  }

  if (coinAmount <= 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Coin amount must be greater than **0**.',
    });
    return;
  }

  // ── 4. Guard: sender must have enough coins ────────────────────────────────
  const senderID = event['senderID'] as string | undefined;
  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  const senderBalance = await currencies.getMoney(senderID);
  if (senderBalance < coinAmount) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Insufficient coins. Your balance: **${senderBalance.toLocaleString()}** coins.`,
    });
    return;
  }

  // ── 5. Guard: cannot transfer to yourself ─────────────────────────────────
  if (targetID === senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ You cannot transfer coins to yourself.',
    });
    return;
  }

  // ── 6. Execute transfer ────────────────────────────────────────────────────
  try {
    await currencies.decreaseMoney({ user_id: senderID, money: coinAmount });
    await currencies.increaseMoney({ user_id: targetID, money: coinAmount });

    const targetName = await user.getName(targetID);
    const newBalance = senderBalance - coinAmount;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `✅ Successfully transferred **${coinAmount.toLocaleString()} coins** to **${targetName}**.`,
        `💰 Your remaining balance: **${newBalance.toLocaleString()} coins**`,
      ].join('\n'),
    });
  } catch (error) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ An error occurred during the transfer. Please try again.',
    });
    throw error; // Re-throw so the engine's error logger captures the stack trace
  }
};
