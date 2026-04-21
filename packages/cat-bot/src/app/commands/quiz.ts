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
 *        and the buttons are removed.
 *     4. A setTimeout reveals the answer if no button is pressed within
 *        TIMEOUT_MS, editing the message and clearing the button context.
 *
 *   Facebook Messenger & Facebook Page  → emoji reactions (original flow)
 *     1. onCommand sends the question and registers a state entry.
 *     2. The user reacts with ❤ (True) or 😢 (False).
 *     3. onReact handlers evaluate the answer and reply.
 *     4. A setTimeout sends a time-up reply if no reaction fires in time.
 *
 * ── Difficulty ───────────────────────────────────────────────────────────────
 * Accepts an optional argument: easy | medium | hard. Any other value (or none)
 * selects a difficulty at random.
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 * Open Trivia DB: https://opentdb.com/api.php
 *   ?amount=1&encode=url3986&type=boolean&difficulty={easy|medium|hard}
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
  version: '1.1.0',
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

/**
 * Reaction emoji constants — used as onReact map keys for the FB flow.
 * Discord normalises ❤ to ❤️ (U+2764 + U+FE0F Variation Selector-16);
 * both variants are registered so the same handler fires on all FB platforms.
 */
const REACT = {
  TRUE:         '❤',
  TRUE_DISCORD: '❤️',
  FALSE:        '😢',
} as const;

/** Local IDs for the True/False answer buttons (Discord & Telegram only). */
const BUTTON_ID = {
  true:  'true',
  false: 'false',
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

/**
 * Stored in button context so onClick handlers know the correct answer.
 * Extends Record<string, unknown> to satisfy button.createContext()'s
 * { context: Record<string, unknown> } parameter constraint.
 */
interface ButtonQuizContext extends Record<string, unknown> {
  answer:     string;
  messageID:  string;
  difficulty: string;
  category:   string;
}

/**
 * Stored in state so onReact handlers know the correct answer (FB flow).
 * Extends Record<string, unknown> to satisfy state.create()'s
 * { context: Record<string, unknown> } parameter constraint.
 */
interface ReactQuizContext extends Record<string, unknown> {
  answer:     string;
  question:   string;
  messageID:  string;
  difficulty: string;
  category:   string;
}

// ── Module-level answered tracker ─────────────────────────────────────────────
// Maps quiz messageID → answered boolean.
// Shared by both the setTimeout closure and the button/react handlers so the
// timeout never fires a double-reveal after the user has already answered.
const pendingAnswers = new Map<string, boolean>();

/** Seconds the user has to answer before the reveal fires automatically. */
const TIMEOUT_MS = 20_000;

// ── Platform helper ───────────────────────────────────────────────────────────

/** Returns true when the platform supports inline buttons and should use the button flow. */
function isButtonPlatform(platform: string): boolean {
  return platform === Platforms.Discord || platform === Platforms.Telegram;
}

// ── Button definitions (Discord & Telegram only) ──────────────────────────────

export const button = {
  // ── ✅ True button ──────────────────────────────────────────────────────────
  [BUTTON_ID.true]: {
    label: '✅ True',
    style: ButtonStyle.SUCCESS,
    onClick: async ({ chat, event, session, button: btn }: AppCtx) => {
      const ctx   = session.context as Partial<ButtonQuizContext>;
      const msgId = ctx.messageID ?? (event['messageID'] as string);
      const answer = ctx.answer   ?? '';

      // Ignore stale clicks after the quiz has already been resolved
      if (pendingAnswers.get(msgId) === true) return;
      pendingAnswers.set(msgId, true);

      // Clean up button context so it stops responding to further clicks
      btn.deleteContext(session.id);

      const isCorrect = 'True' === answer;
      await chat.editMessage({
        style:              MessageStyle.MARKDOWN,
        message_id_to_edit: msgId,
        message: isCorrect
          ? `✅ **Correct!** The answer was **True**. Well done! 🎉`
          : `❌ **Wrong!** You answered **True**, but the correct answer was **False**. 😔`,
      });
    },
  },

  // ── ❌ False button ─────────────────────────────────────────────────────────
  [BUTTON_ID.false]: {
    label: '❌ False',
    style: ButtonStyle.DANGER,
    onClick: async ({ chat, event, session, button: btn }: AppCtx) => {
      const ctx    = session.context as Partial<ButtonQuizContext>;
      const msgId  = ctx.messageID ?? (event['messageID'] as string);
      const answer = ctx.answer    ?? '';

      if (pendingAnswers.get(msgId) === true) return;
      pendingAnswers.set(msgId, true);

      btn.deleteContext(session.id);

      const isCorrect = 'False' === answer;
      await chat.editMessage({
        style:              MessageStyle.MARKDOWN,
        message_id_to_edit: msgId,
        message: isCorrect
          ? `✅ **Correct!** The answer was **False**. Well done! 🎉`
          : `❌ **Wrong!** You answered **False**, but the correct answer was **True**. 😔`,
      });
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

  // Fetch question — url3986 encoding preserves special chars (ampersands, curly quotes)
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
  const platform = native.platform;

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH A — Discord & Telegram: native inline buttons
  // ════════════════════════════════════════════════════════════════════════════
  if (isButtonPlatform(platform)) {
    // Generate public button IDs so any user in the thread can answer
    const trueId  = btn.generateID({ id: BUTTON_ID.true,  public: true });
    const falseId = btn.generateID({ id: BUTTON_ID.false, public: true });

    const messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
        ``,
        question,
        ``,
        `_You have ${TIMEOUT_MS / 1000} seconds to answer!_`,
      ].join('\n'),
      button: [trueId, falseId],
    });

    if (!messageID) {
      await chat.replyMessage({
        style:   MessageStyle.MARKDOWN,
        message: '❌ Button quiz unavailable: this platform did not return a message ID.',
      });
      return;
    }

    const msgIdStr = String(messageID);
    pendingAnswers.set(msgIdStr, false);

    // Store the quiz answer in each button's context so onClick can evaluate it.
    // Both buttons share the same payload — only the label/style differs.
    const ctx: ButtonQuizContext = { answer, messageID: msgIdStr, difficulty, category };
    btn.createContext({ id: trueId,  context: ctx });
    btn.createContext({ id: falseId, context: ctx });

    // Timeout: edit the message to reveal the answer and strip the buttons
    setTimeout(() => {
      if (pendingAnswers.get(msgIdStr) === true) return;
      pendingAnswers.delete(msgIdStr);

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

    return; // Button branch complete — do not fall through to react flow
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH B — Facebook Messenger & Facebook Page: emoji reaction flow
  // ════════════════════════════════════════════════════════════════════════════
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

  // Guard: onReact requires a stable messageID key from the platform
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

  // Mark answered BEFORE state.delete() so the setTimeout closure sees true
  // and skips the auto-reveal even if it fires between this line and the reply
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