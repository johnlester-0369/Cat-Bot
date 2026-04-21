/**
 * /funfact — Random Fun Fact
 *
 * Fetches a random useless/fun fact from uselessfacts.jsph.pl and sends it
 * as a formatted message with a persistent "🔁 Next Fact" button.
 *
 * Flow:
 *   User: /funfact
 *   Bot:  [fun fact text + 🔁 Next Fact button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Next Fact]
 *   Bot:  [edits the same message with a fresh fact — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchFact(): Promise<string | null> {
  try {
    const { data } = await axios.get(
      'https://uselessfacts.jsph.pl/random.json?language=en',
      { timeout: 8000 },
    );
    return (data?.text as string) || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[funfact] fetchFact error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'funfact',
  aliases: ['fact', 'randomfact'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'FunFactBotDev (ported to Cat-Bot)',
  description: 'Get a random fun fact to brighten your day.',
  category: 'Random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Next Fact',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const fact = await fetchFact();

    if (!fact) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: '⚠️ **Error:** No data received. Please try again.',
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

    const message = `💡 **Did you know?**\n\n_${fact}_`;

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
        '⚠️ **Error:** Failed to fetch a fun fact. Please try again later.',
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
