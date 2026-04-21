/**
 * /quote — Random Inspirational Quote
 *
 * Fetches a random quote from dummyjson.com and sends it as a formatted
 * message with a persistent "🔁 Inspire Me" button.
 *
 * Flow:
 *   User: /quote
 *   Bot:  [quote text + author + 🔁 Inspire Me button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Inspire Me]
 *   Bot:  [edits the same message with a fresh quote — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

interface QuoteData {
  quote: string;
  author: string;
}

async function fetchQuote(): Promise<QuoteData | null> {
  try {
    const { data } = await axios.get('https://dummyjson.com/quotes/random', {
      headers: { Accept: 'application/json' },
      timeout: 8000,
    });
    if (!data?.quote) return null;
    return {
      quote: data.quote as string,
      author: (data.author as string) || 'Unknown',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[quote] fetchQuote error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'quote',
  aliases: ['inspire', 'motivation'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported to Cat-Bot)',
  description: 'Get a random inspirational quote.',
  category: 'Random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { inspire: 'inspire' } as const;

export const button = {
  [BUTTON_ID.inspire]: {
    label: '🔁 Inspire Me',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

// Fallback quote used when the API is unreachable on a fresh invocation
const FALLBACK_MESSAGE =
  `📜 **Quote of the Moment**\n\n` +
  `_"Life is what happens when you're busy making other plans."_\n\n` +
  `— **John Lennon**`;

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const data = await fetchQuote();

    if (!data) {
      // On button click, show a plain error; on fresh command, show the fallback quote
      if (event['type'] === 'button_action') {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message:
            '⚠️ **Network Error:** Could not fetch a quote. Please try again.',
          message_id_to_edit: event['messageID'] as string,
        });
      } else {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: FALLBACK_MESSAGE,
        });
      }
      return;
    }

    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.inspire, public: true });

    const message =
      `📜 **Quote of the Moment**\n\n` +
      `_"${data.quote}"_\n\n` +
      `— **${data.author}**`;

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
      message: '⚠️ **Error:** Failed to fetch a quote. Please try again later.',
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
