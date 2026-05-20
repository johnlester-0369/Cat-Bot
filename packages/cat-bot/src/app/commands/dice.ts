/**
 * /dice — Dice Roll Gamble
 *
 * Guess which number (1–6) the die lands on. Correct guess pays 2× the bet;
 * wrong guess forfeits the full wager.
 *
 * Win:  +bet (net profit = bet)
 * Lose: −bet
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYOUT_MULTIPLIER = 2;
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'dice',
  aliases: ['roll', 'diceroll'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Rattle the dice and gamble your bet. Guess 1–6; correct guess pays 2×.',
  category: 'Economy',
  usage: '<bet> <1-6>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBet(raw: string, balance: number): number {
  const v = raw.trim().toLowerCase().replace(/,/g, '');
  if (v === 'all' || v === 'max') return Math.floor(balance);
  if (v === 'half') return Math.floor(balance / 2);

  const m = v.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m) return NaN;
  const amount = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  const mult =
    suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  return Math.floor(amount * mult);
}

function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

// ── Button definitions ────────────────────────────────────────────────────────

interface CtxData {
  resultMessage: string;
  balanceId: string;
  backId: string;
}

const BUTTON_ID = { balance: 'balance', back: 'back' } as const;

export const button = {
  [BUTTON_ID.balance]: {
    label: '💰 My Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, currencies, native, session }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) return;

      const ctx = session.context as unknown as CtxData | undefined;
      if (!ctx) return;

      const coins = await currencies.getMoney(senderID);
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: `💰 **Current Balance:** ${coins.toLocaleString()} coins`,
        ...(hasNativeButtons(native.platform) ? { button: [ctx.backId] } : {}),
      });
    },
  },

  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session }: AppCtx) => {
      const ctx = session.context as unknown as CtxData | undefined;
      if (!ctx) return;

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: ctx.resultMessage,
        ...(hasNativeButtons(native.platform) ? { button: [ctx.balanceId] } : {}),
      });
    },
  },
};

// ── Command handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  args,
  usage,
  currencies,
  native,
  button: btn,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;
  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  const rawBet = args[0];
  const rawSide = args[1];

  if (!rawBet || !rawSide) {
    await usage();
    return;
  }

  const chosenSide = parseInt(rawSide, 10);
  if (isNaN(chosenSide) || chosenSide < 1 || chosenSide > 6) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid side. Choose a number between **1 and 6** (inclusive).',
    });
    return;
  }

  const balance = await currencies.getMoney(senderID);
  const bet = parseBet(rawBet, balance);

  if (isNaN(bet) || bet <= 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid bet. Enter a positive number.',
    });
    return;
  }

  if (balance < bet) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Not enough balance. You tried to bet **${bet.toLocaleString()}** coins but only have **${balance.toLocaleString()}**.`,
    });
    return;
  }

  // ── Roll the die ───────────────────────────────────────────────────────────
  const rolled = rollDie();
  const isWin = rolled === chosenSide;
  const payout = isWin ? bet * PAYOUT_MULTIPLIER : 0;
  const netDelta = isWin ? payout - bet : -bet;
  const balAfter = balance + netDelta;
  const profit = isWin ? `+${payout.toLocaleString()}` : `-${bet.toLocaleString()}`;

  if (isWin) {
    await currencies.increaseMoney({ user_id: senderID, money: payout - bet });
  } else {
    await currencies.decreaseMoney({ user_id: senderID, money: bet });
  }

  const diceEmoji = DICE_FACES[rolled - 1];
  const yourEmoji = DICE_FACES[chosenSide - 1];
  const hitMark = isWin ? '✅' : '❌';

  const flavorWin = [
    "The dice didn't just roll… they listened! 🎲✨",
    "Luck leaned your way this time. 🍀",
    "Clean hit. No hesitation. 🎯",
  ];
  const flavorLose = [
    "The dice had other plans… 🎲",
    "Fortune blinked—and missed. 😵",
    "That roll felt personal…",
  ];
  const flavor = isWin
    ? flavorWin[Math.floor(Math.random() * flavorWin.length)]
    : flavorLose[Math.floor(Math.random() * flavorLose.length)];

  const resultMessage = [
    `🎲 **Dice Game**`,
    `The dice have been cast... fate reveals your number.`,
    ``,
    `**Result:**`,
    `${yourEmoji} Your Number: **${chosenSide}**`,
    `${diceEmoji} Rolled Number: **${rolled}**`,
    `💰 Your Bet: **${bet.toLocaleString()}** coins`,
    `🧾 Outcome: **${isWin ? 'Perfect hit!' : 'You lost...'}**`,
    ``,
    `**Roll Details:**`,
    `🎲 Dice Roll → ${diceEmoji} **${rolled}**`,
    `🎯 Target → ${yourEmoji} **${chosenSide}** ${hitMark}`,
    `⚖️ Multiplier → ×${PAYOUT_MULTIPLIER}`,
    ``,
    `**Balance:**`,
    `🪙 ${balance.toLocaleString()} → ${Math.round(balAfter).toLocaleString()} (**${profit}**)`,
    ``,
    flavor,
  ].join('\n');

  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });
  const ctx: CtxData = { resultMessage, balanceId, backId };

  // Cast context payloads to expected generic Record<string, unknown>
  btn.createContext({ id: balanceId, context: ctx as unknown as Record<string, unknown> });
  btn.createContext({ id: backId, context: ctx as unknown as Record<string, unknown> });

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: resultMessage,
    ...(hasNativeButtons(native.platform) ? { button: [balanceId] } : {}),
  });
};
