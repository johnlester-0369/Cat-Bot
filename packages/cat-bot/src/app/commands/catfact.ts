/**
 * /catfact — Random Cat Fact
 *
 * Fetches a random cat fact from catfact.ninja and sends it as a formatted
 * message with a persistent "🔁 Random Fact" button.
 *
 * Flow:
 *   User: /catfact
 *   Bot:  [cat fact text + 🔁 Random Fact button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Random Fact]
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
    const { data } = await axios.get('https://catfact.ninja/fact', {
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });
    return (data?.fact as string) || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[catfact] fetchFact error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'catfact',
  aliases: ['catfacts', 'meowfact'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported to Cat-Bot)',
  description: 'Get a random interesting fact about cats.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Random Fact',
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
        message: '⚠️ **Error:** Could not retrieve a cat fact.',
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

    const message = `✨ **Cat Fact:**\n\n_${fact}_`;

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
        '⚠️ **System Error:** Failed to fetch a cat fact. Please try again later.',
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
