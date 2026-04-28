/**
 * /joke — Random Joke
 *
 * Fetches a random setup/punchline joke from the Official Joke API and sends
 * it as a formatted message with a persistent "🔄 Next Joke" button.
 *
 * Flow:
 *   User: /joke
 *   Bot:  [joke text + 🔄 Next Joke button, threaded under user's message on Telegram]
 *   User: [clicks 🔄 Next Joke]
 *   Bot:  [edits the same message with a fresh joke — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchJoke(): Promise<string | null> {
  try {
    const { data } = await axios.get(
      'https://official-joke-api.appspot.com/random_joke',
      { timeout: 10000 },
    );
    if (!data?.setup || !data?.punchline) {
      throw new Error('Invalid data structure received from API');
    }
    return `**${data.setup as string}**\n\n_${data.punchline as string}_`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[joke] fetchJoke error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'joke',
  aliases: ['telljoke', 'haha', 'funny'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'JokeBotDev (ported to Cat-Bot)',
  description: 'Get a random joke to lighten the mood.',
  category: 'random',
  usage: '',
  cooldown: 3,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔄 Next Joke',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const jokeText = await fetchJoke();

    if (!jokeText) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message:
          "⚠️ **Error:** I couldn't think of a joke right now. Try again!",
      };
      if (event['type'] === 'button_action') {
        await chat.editMessage({
          ...errPayload,
          message_id_to_edit: event['messageID'] as string,
        });
      } else {
        await chat.replyMessage(errPayload);
      }
      return;
    }

    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.next, public: true });

    const message = `🤣 **Random Joke**\n\n${jokeText}`;

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message,
        message_id_to_edit: event['messageID'] as string,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ **System Error:** Failed to fetch a joke. Please try again later.',
    };
    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
};
