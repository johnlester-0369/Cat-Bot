/**
 * Rock Paper Scissors Command
 * A classic game using the native button system.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'rps',
  aliases: ['rockpaperscissors', 'janken'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'JohnDev19',
  description: 'Play a game of Rock, Paper, Scissors.',
  category: 'Fun',
  usage: '',
  cooldown: 3,
  hasPrefix: true,
};

// ── Constants ─────────────────────────────────────────────────────────────────

const CHOICES = ['rock', 'paper', 'scissors'] as const;
type Choice = (typeof CHOICES)[number];

const EMOJIS: Record<Choice, string> = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
};

const BUTTON_ID = {
  rock: 'rock',
  paper: 'paper',
  scissors: 'scissors',
  playAgain: 'play_again',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getResult(
  player: Choice,
  bot: Choice,
): { text: string; icon: string } {
  if (player === bot) return { text: "It's a tie!", icon: '🤝' };
  if (
    (player === 'rock' && bot === 'scissors') ||
    (player === 'paper' && bot === 'rock') ||
    (player === 'scissors' && bot === 'paper')
  ) {
    return { text: 'You won!', icon: '🎉' };
  }
  return { text: 'You lost!', icon: '💀' };
}

// ── Game logic (shared between onCommand and play_again button) ───────────────

async function startGame(ctx: AppCtx): Promise<void> {
  const { chat, button, native, event } = ctx;

  if (!hasNativeButtons(native.platform)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '🤜 **Rock, Paper, Scissors!**\n' +
        'Reply with your choice: **rock**, **paper**, or **scissors**',
    });
    return;
  }

  const rockId = button.generateID({ id: BUTTON_ID.rock, public: false });
  const paperId = button.generateID({ id: BUTTON_ID.paper, public: false });
  const scissorsId = button.generateID({
    id: BUTTON_ID.scissors,
    public: false,
  });

  if (event['type'] === 'button_action') {
    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: event['messageID'] as string,
      message: '🤜 **Rock, Paper, Scissors!**\nChoose your weapon:',
      button: [rockId, paperId, scissorsId],
    });
  } else {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🤜 **Rock, Paper, Scissors!**\nChoose your weapon:',
      button: [rockId, paperId, scissorsId],
    });
  }
}

async function playMove(ctx: AppCtx, playerChoice: Choice): Promise<void> {
  const { chat, event, button } = ctx;

  const botChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)]!;
  const result = getResult(playerChoice, botChoice);

  const resultMessage =
    `**Result:** ${result.text} ${result.icon}\n\n` +
    `👤 You: **${playerChoice.toUpperCase()}** ${EMOJIS[playerChoice]}\n` +
    `🤖 Bot: **${botChoice.toUpperCase()}** ${EMOJIS[botChoice]}`;

  // Generate a fresh play_again button ID so clicking "Try Again" correctly
  // routes to the playAgain handler (startGame) and not the choice that was just clicked.
  const tryAgainId = button.generateID({
    id: BUTTON_ID.playAgain,
    public: false,
  });

  await chat.editMessage({
    style: MessageStyle.MARKDOWN,
    message_id_to_edit: event['messageID'] as string,
    message: resultMessage,
    button: [tryAgainId],
  });
}

// ── Button definitions ────────────────────────────────────────────────────────

export const button = {
  [BUTTON_ID.rock]: {
    label: `Rock ${EMOJIS.rock}`,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => playMove(ctx, 'rock'),
  },

  [BUTTON_ID.paper]: {
    label: `Paper ${EMOJIS.paper}`,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => playMove(ctx, 'paper'),
  },

  [BUTTON_ID.scissors]: {
    label: `Scissors ${EMOJIS.scissors}`,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => playMove(ctx, 'scissors'),
  },

  [BUTTON_ID.playAgain]: {
    label: '🔁 Try Again',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => startGame(ctx),
  },
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await startGame(ctx);
};
