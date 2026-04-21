/**
 * /quiz — True/False Trivia Game
 *
 * Fetches a boolean True/False question from the Open Trivia Database.
 *
 * ── Platform-split answer flow ───────────────────────────────────────────────
 *
 *   Discord & Telegram  → native inline buttons (✅ True | ❌ False)
 *     1. onCommand sends the question with two answer buttons.
 *     2. button.createContext() stores the answer so each onClick handler
 *        can evaluate the user's choice without re-fetching.
 *     3. On click, the message is edited in-place to reveal the result
 *        and a 🔄 Play Again button replaces the answer buttons.
 *     4. Clicking Play Again re-edits the SAME message in-place with a
 *        brand-new question (and fresh True/False buttons), preserving the
 *        same difficulty. (Matches the RPS command pattern for cleaner chat.)
 *     5. A setTimeout reveals the answer if no button is pressed within
 *        TIMEOUT_MS, editing the message and stripping all buttons.
 *
 *   Facebook Messenger & Facebook Page  → emoji reactions (original flow)
 *
 * ── Difficulty ───────────────────────────────────────────────────────────────
 * Accepts an optional argument: easy | medium | hard. Any other value (or none)
 * selects a difficulty at random. Play Again preserves the previous difficulty.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

export const config = {
  name: 'quiz',
  aliases: ['trivia'] as string[],
  version: '1.3.1',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Answer a True/False trivia question. Buttons on Discord/Telegram, reactions on Facebook.',
  category: 'Game',
  usage: '[easy | medium | hard]',
  cooldown: 10,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'difficulty',
      description:
        'Question difficulty: easy, medium, or hard (random if omitted)',
      required: false,
    },
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

const REACT = {
  TRUE:         '❤',
  TRUE_DISCORD: '❤️',
  FALSE:        '😢',
} as const;

/** Local IDs for the answer + play-again buttons (Discord & Telegram only). */
const BUTTON_ID = {
  true:      'true',
  false:     'false',
  playAgain: 'play_again',
} as const;

interface TriviaResult {
  question:       string;
  correct_answer: 'True' | 'False';
  difficulty:     string;
  category:       string;
}

interface TriviaResponse {
  response_code: number;
  results:       TriviaResult[];
}

interface ButtonQuizContext extends Record<string, unknown> {
  answer:     string;
  question:   string;
  messageID:  string;
  difficulty: Difficulty;
  category:   string;
}

interface ReactQuizContext extends Record<string, unknown> {
  answer:     string;
  question:   string;
  messageID:  string;
  difficulty: string;
  category:   string;
}

// ── Module-level trackers ─────────────────────────────────────────────────────
const pendingAnswers = new Map<string, boolean>();
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

const TIMEOUT_MS = 20_000;

// ── Platform helper ───────────────────────────────────────────────────────────
function isButtonPlatform(platform: string): boolean {
  return platform === Platforms.Discord || platform === Platforms.Telegram;
}

// ── Core quiz runner (shared by onCommand and Play Again) ─────────────────────
async function runButtonQuiz(
  ctx: AppCtx,
  difficulty: Difficulty,
): Promise<void> {
  const { chat, button: btn, event } = ctx;

  // Fetch question
  let result: TriviaResult;
  try {
    const response = await axios.get<TriviaResponse>(
      `https://opentdb.com/api.php?amount=1&encode=url3986&type=boolean&difficulty=${difficulty}`,
    );
    const first = response.data.results[0];
    if (response.data.response_code !== 0 || !first) {
      throw new Error(`API response_code=${response.data.response_code}`);
    }
    result = first;
  } catch {
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: '❌ Could not fetch a trivia question — the server may be busy. Please try again!',
    });
    return;
  }

  const question = decodeURIComponent(result.question);
  const category = decodeURIComponent(result.category);
  const answer   = result.correct_answer;

  const trueId  = btn.generateID({ id: BUTTON_ID.true,  public: true });
  const falseId = btn.generateID({ id: BUTTON_ID.false, public: true });

  const isFromButtonAction = event?.['type'] === 'button_action';
  let messageID: string | number | null = null;

  if (isFromButtonAction) {
    // Play Again: edit the existing message in-place (RPS-style)
    const currentMsgID = event['messageID'];

    if (typeof currentMsgID !== 'string' && typeof currentMsgID !== 'number') {
      await chat.replyMessage({
        style:   MessageStyle.MARKDOWN,
        message: '❌ Could not restart quiz: missing message ID.',
      });
      return;
    }

    messageID = currentMsgID;

    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: String(messageID),
      message: [
        `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
        ``,
        question,
        ``,
        `_You have ${TIMEOUT_MS / 1000} seconds to answer!_`,
      ].join('\n'),
      button: [trueId, falseId],
    });
  } else {
    // Initial command: send a brand-new message
    messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
        ``,
        question,
        ``,
        `_You have ${TIMEOUT_MS / 1000} seconds to answer!_`,
      ].join('\n'),
      button: [trueId, falseId],
    }) as string | number | null;
  }

  if (!messageID) {
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: '❌ Button quiz unavailable: this platform did not return a message ID.',
    });
    return;
  }

  const msgIdStr = String(messageID);

  // Cancel any previous timeout for this message (prevents overlap on Play Again)
  if (timeouts.has(msgIdStr)) {
    clearTimeout(timeouts.get(msgIdStr)!);
    timeouts.delete(msgIdStr);
  }

  pendingAnswers.set(msgIdStr, false);

  // Store full context so onClick handlers know the correct answer
  const quizCtx: ButtonQuizContext = {
    answer,
    question,
    messageID: msgIdStr,
    difficulty,
    category,
  };
  btn.createContext({ id: trueId,  context: quizCtx });
  btn.createContext({ id: falseId, context: quizCtx });

  // Timeout: reveal the answer and strip all buttons
  const timeoutHandle = setTimeout(() => {
    if (pendingAnswers.get(msgIdStr) === true) return;
    pendingAnswers.delete(msgIdStr);
    timeouts.delete(msgIdStr);

    void chat.editMessage({
      style:              MessageStyle.MARKDOWN,
      message_id_to_edit: msgIdStr,
      message: [
        `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
        ``,
        question,
        ``,
        `⏰ **Time's up!** The correct answer was **${answer}**.`,
      ].join('\n'),
      // Omitting `button` removes the inline keyboard on edit
    });
  }, TIMEOUT_MS);

  timeouts.set(msgIdStr, timeoutHandle);
}

// ── Shared result editor (button flow) ────────────────────────────────────────
async function showButtonResult(
  ctx: AppCtx,
  userAnswer: 'True' | 'False',
): Promise<void> {
  const { chat, event, session, button: btn } = ctx;
  const quizCtx    = session.context as Partial<ButtonQuizContext>;
  const msgId      = quizCtx.messageID ?? (event['messageID'] as string);
  const answer     = quizCtx.answer    ?? '';
  const difficulty = (quizCtx.difficulty ?? 'medium') as Difficulty;
  const question   = quizCtx.question   ?? '';
  const category   = quizCtx.category   ?? '';

  // Guard against double-resolution (stale click after timeout or another user)
  if (pendingAnswers.get(msgId) === true) return;
  pendingAnswers.set(msgId, true);

  // Cancel the active timeout for this message
  if (timeouts.has(msgId)) {
    clearTimeout(timeouts.get(msgId)!);
    timeouts.delete(msgId);
  }

  // Clean up the answer button contexts — they are no longer needed
  btn.deleteContext(session.id);

  const isCorrect   = userAnswer === answer;
  const resultLine  = isCorrect
    ? `✅ **Correct!** The answer was **${answer}**. Well done! 🎉`
    : `❌ **Wrong!** You answered **${userAnswer}**, but the correct answer was **${answer}**. 😔`;

  // Generate Play Again button and store the difficulty
  const playAgainId = btn.generateID({ id: BUTTON_ID.playAgain, public: true });
  btn.createContext({
    id:      playAgainId,
    context: { difficulty } satisfies Record<string, unknown>,
  });

  await chat.editMessage({
    style:              MessageStyle.MARKDOWN,
    message_id_to_edit: msgId,
    message: [
      `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
      ``,
      question,
      ``,
      resultLine,
    ].join('\n'),
    button: [playAgainId],
  });
}

// ── Button definitions ────────────────────────────────────────────────────────
export const button = {
  // ── ✅ True ─────────────────────────────────────────────────────────────────
  [BUTTON_ID.true]: {
    label: '✅ True',
    style: ButtonStyle.SUCCESS,
    onClick: async (ctx: AppCtx) => showButtonResult(ctx, 'True'),
  },

  // ── ❌ False ────────────────────────────────────────────────────────────────
  [BUTTON_ID.false]: {
    label: '❌ False',
    style: ButtonStyle.DANGER,
    onClick: async (ctx: AppCtx) => showButtonResult(ctx, 'False'),
  },

  // ── 🔄 Play Again ───────────────────────────────────────────────────────────
  [BUTTON_ID.playAgain]: {
    label: '🔄 Play Again',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      const { button: btn, session } = ctx;

      const storedDifficulty = session.context['difficulty'] as Difficulty | undefined;
      const difficulty: Difficulty =
        storedDifficulty && (DIFFICULTIES as readonly string[]).includes(storedDifficulty)
          ? storedDifficulty
          : (DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)] ?? 'medium');

      // Clean up the Play Again button context
      btn.deleteContext(session.id);

      await runButtonQuiz(ctx, difficulty);
    },
  },
};

// ── Command entry point ───────────────────────────────────────────────────────
export const onCommand = async ({
  chat,
  state,
  args,
  native,
  button: btn,
}: AppCtx): Promise<void> => {
  // Resolve difficulty from arg or pick randomly
  const rawArg = (args[0] ?? '').toLowerCase();
  const difficulty: Difficulty =
    (DIFFICULTIES as readonly string[]).includes(rawArg)
      ? (rawArg as Difficulty)
      : (DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)] ?? 'medium');

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH A — Discord & Telegram: native inline buttons
  // ════════════════════════════════════════════════════════════════════════════
  if (isButtonPlatform(native.platform)) {
    await runButtonQuiz({ chat, state, native, button: btn } as AppCtx, difficulty);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH B — Facebook Messenger & Facebook Page: emoji reaction flow
  // ════════════════════════════════════════════════════════════════════════════

  // Fetch question
  let result: TriviaResult;
  try {
    const response = await axios.get<TriviaResponse>(
      `https://opentdb.com/api.php?amount=1&encode=url3986&type=boolean&difficulty=${difficulty}`,
    );
    const first = response.data.results[0];
    if (response.data.response_code !== 0 || !first) {
      throw new Error(`API response_code=${response.data.response_code}`);
    }
    result = first;
  } catch {
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: '❌ Could not fetch a trivia question — the server may be busy. Please try again!',
    });
    return;
  }

  const question = decodeURIComponent(result.question);
  const category = decodeURIComponent(result.category);
  const answer   = result.correct_answer;

  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
      ``,
      question,
      ``,
      `❤️ → **True**   |   😢 → **False**`,
      `_You have ${TIMEOUT_MS / 1000} seconds to react!_`,
    ].join('\n'),
  });

  if (!messageID) {
    await chat.replyMessage({
      style:   MessageStyle.MARKDOWN,
      message: '❌ onReact unavailable: this platform did not return a message ID from chat.replyMessage().',
    });
    return;
  }

  const msgIdStr = String(messageID);
  pendingAnswers.set(msgIdStr, false);

  state.create({
    id:    state.generateID({ id: msgIdStr }),
    state: [REACT.TRUE, REACT.TRUE_DISCORD, REACT.FALSE],
    context: {
      answer,
      question,
      messageID: msgIdStr,
      difficulty,
      category,
    } satisfies ReactQuizContext,
  });

  // Timeout: reply with the reveal if no reaction fires within the window
  setTimeout(() => {
    const alreadyAnswered = pendingAnswers.get(msgIdStr) ?? false;
    pendingAnswers.delete(msgIdStr);

    if (!alreadyAnswered) {
      void chat.replyMessage({
        style:   MessageStyle.MARKDOWN,
        message: `⏰ **Time's up!** The correct answer was **${answer}**.`,
      });
    }
  }, TIMEOUT_MS);
};

// ── Shared reaction evaluator (FB flow) ───────────────────────────────────────
async function handleReact(
  { chat, session, state }: AppCtx,
  userAnswer: 'True' | 'False',
): Promise<void> {
  const ctx           = session.context as Partial<ReactQuizContext>;
  const msgId         = ctx.messageID  ?? '';
  const correctAnswer = ctx.answer     ?? '';

  pendingAnswers.set(msgId, true);
  state.delete(session.id);

  const isCorrect = userAnswer === correctAnswer;

  await chat.reply({
    style:   MessageStyle.MARKDOWN,
    message: isCorrect
      ? `✅ **Correct!** The answer was **${correctAnswer}**. Well done! 🎉`
      : `❌ **Wrong!** You answered **${userAnswer}**, but the correct answer was **${correctAnswer}**. 😔`,
  });
}

// ── Reaction handlers (FB Messenger & FB Page only) ───────────────────────────
export const onReact = {
  /** ❤  (U+2764)       — "True" on FB Messenger & FB Page */
  [REACT.TRUE]:         async (ctx: AppCtx) => handleReact(ctx, 'True'),
  /** ❤️ (U+2764+FE0F)  — "True" on Discord (Variation Selector-16 appended) */
  [REACT.TRUE_DISCORD]: async (ctx: AppCtx) => handleReact(ctx, 'True'),
  /** 😢                — "False" on all platforms */
  [REACT.FALSE]:        async (ctx: AppCtx) => handleReact(ctx, 'False'),
};