/**
 * /quiz — True/False Trivia Game
 *
 * Fetches a boolean True/False question from the Open Trivia Database and
 * sends it to the thread. The user answers by reacting with an emoji:
 *
 *   User: /quiz [easy|medium|hard]
 *   Bot:  🧠 Trivia Quiz — medium · Science: Computers
 *         "GitHub was originally called Logical Awesome LLC."
 *         ❤ → True   |   😢 → False
 *         (You have 20 seconds to react!)
 *   User: [reacts with ❤]
 *   Bot:  ✅ Correct! The answer was True. Well done! 🎉
 *
 * ── Reaction Flow ────────────────────────────────────────────────────────────
 *   1. onCommand fetches a question and sends it, capturing the returned messageID.
 *   2. state.create() registers the messageID in the unified stateStore.
 *   3. When the user reacts, dispatchOnReact() matches the messageID and routes
 *      to onReact['❤'] (True) or onReact['😢'] (False).
 *   4. The handler marks the question as answered, deletes state, and replies.
 *
 * ── Timeout Handling ─────────────────────────────────────────────────────────
 * A module-level Map tracks per-message answered state. The setTimeout closure
 * captures the same Map key so it can skip the reveal when onReact fires first.
 * This avoids a double-reply without requiring a state.get() API.
 *
 * ── Difficulty ───────────────────────────────────────────────────────────────
 * Accepts an optional argument: easy | medium | hard. Any other value (or none)
 * selects a difficulty at random — mirrors the original GoatBot implementation.
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 * Open Trivia DB: https://opentdb.com/api.php
 *   ?amount=1&encode=url3986&type=boolean&difficulty={easy|medium|hard}
 * url3986 encoding is used so questions with special characters
 * (ampersands, quotes) survive the JSON transport layer.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'quiz',
  aliases: ['trivia'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Answer a True/False trivia question. React ❤ for True, 😢 for False.',
  category: 'Game',
  usage: '[easy | medium | hard]',
  cooldown: 10,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'difficulty',
      description: 'Question difficulty: easy, medium, or hard (random if omitted)',
      required: false,
    },
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

// Single source of truth for reaction emojis — onCommand (state.create array) and
// onReact computed property keys both reference these constants so a future emoji
// change (e.g. adding a variation selector) only needs to be made in one place.
const STATE = {
  TRUE: '❤',
  // Discord normalises every heart reaction to U+2764 + U+FE0F (Variation Selector-16),
  // emitting '❤️' rather than the bare '❤' that FB Messenger, FB Page, and Telegram send.
  // Both variants must be registered so the same quiz works across all four platforms.
  TRUE_DISCORD: '❤️',
  FALSE: '😢',
} as const;


/** Shape of a single result object from the Open Trivia DB boolean endpoint. */
interface TriviaResult {
  question: string;
  correct_answer: 'True' | 'False';
  difficulty: string;
  category: string;
}

/** Top-level shape of the Open Trivia DB API response. */
interface TriviaResponse {
  response_code: number;
  results: TriviaResult[];
}

/** Context stored inside state.create() so onReact handlers can read the answer. */
interface QuizContext {
  answer: string;
  question: string;
  messageID: string;
  difficulty: string;
  category: string;
}

// ── Module-level answered tracker ─────────────────────────────────────────────
// Maps bot messageID → whether the user has already reacted to that quiz.
// Shared between onCommand's setTimeout closure and the onReact handlers
// without needing a state.get() API — keeps Cat-Bot's state store as write-only
// from the command layer, consistent with all other commands.
const pendingAnswers = new Map<string, boolean>();

/** How long (ms) the user has to react before the answer is auto-revealed. */
const TIMEOUT_MS = 20_000;

// ── Command entry point ───────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  state,
  args,
}: AppCtx): Promise<void> => {
  // Pick difficulty from arg or randomly — matches the original GoatBot behaviour
  const rawArg = (args[0] ?? '').toLowerCase();
  const difficulty: Difficulty = (DIFFICULTIES as readonly string[]).includes(
    rawArg,
  )
    ? (rawArg as Difficulty)
    : (DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)] ??
        'medium');

  // Fetch one boolean question — url3986 encoding preserves special characters in
  // question text (ampersands, curly quotes) that would otherwise corrupt JSON
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
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Could not fetch a trivia question — the server may be busy. Please try again!',
    });
    return;
  }

  // Decode percent-encoded question text and category from url3986 format
  const question = decodeURIComponent(result.question);
  const category = decodeURIComponent(result.category);
  const answer = result.correct_answer;

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

  // Guard: platforms that don't return a messageID from replyMessage cannot support
  // onReact because there's no stable key to register pending state against
  if (!messageID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ onReact unavailable: this platform did not return a message ID from chat.replyMessage().',
    });
    return;
  }

  const msgIdStr = String(messageID);

  // Register false (unanswered) before state.create() so the Map entry is always
  pendingAnswers.set(msgIdStr, false);

  // state array declares every emoji this quiz accepts — dispatchOnReact still routes on
  // event.reaction at runtime, so each onReact[emoji] handler resolves independently.
  // Listing the accepted emojis here makes valid reactions self-documenting in the state store.
  state.create({
    id: state.generateID({ id: msgIdStr }),
    state: [STATE.TRUE, STATE.TRUE_DISCORD, STATE.FALSE],
    context: {
      answer,
      question,
      messageID: msgIdStr,
      difficulty,
      category,
    } satisfies QuizContext,
  });

  // Reveal the answer after the timeout window if the user has not yet reacted.
  // The `chat` closure is thread-scoped to this invocation, so reply() routes correctly
  // even though this callback fires outside the normal message handler lifecycle.
  setTimeout(() => {
    const alreadyAnswered = pendingAnswers.get(msgIdStr) ?? false;
    pendingAnswers.delete(msgIdStr);

    if (!alreadyAnswered) {
      void chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⏰ **Time's up!** The correct answer was **${answer}**.`,
      });
    }
  }, TIMEOUT_MS);
};

// ── Shared reaction handler ───────────────────────────────────────────────────

/**
 * Evaluates the user's reaction against the stored answer.
 * Called by both emoji handlers so the comparison logic lives in one place.
 */
async function handleReact(
  { chat, session, state }: AppCtx,
  userAnswer: 'True' | 'False',
): Promise<void> {
  const ctx = session.context as Partial<QuizContext>;
  const msgId = ctx.messageID ?? '';
  const correctAnswer = ctx.answer ?? '';
  // Mark as answered BEFORE state.delete() — the Map key must exist when the
  // setTimeout callback fires so it sees answered=true and skips the timeout reply
  pendingAnswers.set(msgId, true);

  // Remove state before replying so a second reaction on the same message does
  // not re-trigger this handler after the quiz is resolved
  state.delete(session.id);

  const isCorrect = userAnswer === correctAnswer;

  await chat.reply({
    style: MessageStyle.MARKDOWN,
    message: isCorrect
      ? `✅ **Correct!** The answer was **${correctAnswer}**. Well done! 🎉`
      : `❌ **Wrong!** You answered **${userAnswer}**, but the correct answer was **${correctAnswer}**. 😔`,
  });
}

// ── Reaction handlers — emoji keys match what dispatchOnReact receives ────────

export const onReact = {
  /** User reacted with ❤ — interpreted as "True". */
  [STATE.TRUE]: async (ctx: AppCtx) => handleReact(ctx, 'True'),

  /** User reacted with 😢 — interpreted as "False". */
  [STATE.FALSE]: async (ctx: AppCtx) => handleReact(ctx, 'False'),
};
