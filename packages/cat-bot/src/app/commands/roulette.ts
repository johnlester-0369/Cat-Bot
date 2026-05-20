/**
 * /roulette — Roulette Gamble
 *
 * Spin the roulette wheel and bet on a color (red/black/green) and optionally
 * an exact number (0–36). Payouts follow real roulette logic:
 *
 * Red or Black (color only) → ×2 payout
 * Green (color only)        → ×35 payout
 * Exact number guess        → ×35 payout (regardless of color)
 *
 * Green has a 1/37 chance (number 0 only), making it the long-shot bet.
 *
 * Usage:
 * roulette <bet> <red | black | green>
 * roulette <bet> <red | black | green> <0-36>   — add exact number
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

type RouletteColor = 'red' | 'black' | 'green';

const COLOR_EMOJIS: Record<RouletteColor, string> = {
  red: '🔴',
  black: '⚫',
  green: '🟢',
};

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'roulette',
  aliases: ['rl'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Spin the roulette wheel. Bet on red/black/green and optionally an exact number.',
  category: 'Economy',
  usage: '<bet> <red | black | green> [0-36]',
  cooldown: 5,
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

function rollWheel(): { color: RouletteColor; number: number } {
  const num = Math.floor(Math.random() * 37); // 0–36
  let color: RouletteColor;
  if (num === 0) color = 'green';
  else if (REDS.has(num)) color = 'red';
  else color = 'black';
  return { color, number: num };
}

function calcPayout(
  bet: number,
  guessColor: RouletteColor,
  guessNumber: number | null,
  result: { color: RouletteColor; number: number },
): number {
  if (guessNumber !== null && guessNumber === result.number) return bet * 35;
  if (guessColor === result.color) {
    return guessColor === 'green' ? bet * 35 : bet * 2;
  }
  return 0;
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
  const rawColor = args[1]?.toLowerCase() as RouletteColor | undefined;
  const rawNumber = args[2];

  if (!rawBet || !rawColor) {
    await usage();
    return;
  }

  if (!['red', 'black', 'green'].includes(rawColor)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid color. Choose **red**, **black**, or **green**.',
    });
    return;
  }

  let guessNumber: number | null = null;
  if (rawNumber !== undefined) {
    const n = parseInt(rawNumber, 10);
    if (isNaN(n) || n < 0 || n > 36) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Invalid number. Must be between **0 and 36**.',
      });
      return;
    }
    guessNumber = n;
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
      message: `❌ You don't have enough coins to bet **${bet.toLocaleString()}**.`,
    });
    return;
  }

  // ── Spin the wheel ─────────────────────────────────────────────────────────
  const result = rollWheel();
  const payout = calcPayout(bet, rawColor, guessNumber, result);
  const won = payout > 0;
  const balanceChange = won ? payout - bet : -bet;
  const balAfter = balance + balanceChange;

  if (won) {
    await currencies.increaseMoney({ user_id: senderID, money: payout - bet });
  } else {
    await currencies.decreaseMoney({ user_id: senderID, money: bet });
  }

  const resultEmoji = COLOR_EMOJIS[result.color];
  const guessEmoji = COLOR_EMOJIS[rawColor];
  const guessDisplay = `${guessEmoji} **${rawColor}**${guessNumber !== null ? ` (${guessNumber})` : ''}`;
  const balSign = won ? `+${(payout - bet).toLocaleString()}` : `-${bet.toLocaleString()}`;

  const resultMessage = [
    `🎰 **Roulette**`,
    `The wheel has spoken...`,
    ``,
    `**Result:**`,
    `${resultEmoji} Landed: **${result.color}** (${result.number})`,
    `🎯 Your guess: ${guessDisplay}`,
    `${won ? '✅ **You won!**' : '❌ **You lost.**'}`,
    ``,
    `**Balance:**`,
    `🪙 ${balance.toLocaleString()} ➜ ${Math.round(balAfter).toLocaleString()} (**${balSign}**)`,
    ``,
    won ? `Payout: **${payout.toLocaleString()}** coins!` : 'Better luck next time!',
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
