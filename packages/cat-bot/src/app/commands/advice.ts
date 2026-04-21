/**
 * /advice — Random Life Advice
 *
 * Fetches a random piece of advice from the Advice Slip API and sends it as
 * a formatted message with a persistent "🔁 Another" button.
 *
 * Flow:
 *   User: /advice
 *   Bot:  [advice text + 🔁 Another button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Another]
 *   Bot:  [edits the same message with fresh advice — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchAdvice(): Promise<string | null> {
  try {
    const { data } = await axios.get('https://api.adviceslip.com/advice', {
      timeout: 5000,
      headers: { Accept: 'application/json' },
    });
    return (data?.slip?.advice as string) || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[advice] fetchAdvice error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'advice',
  aliases: ['tips'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported to Cat-Bot)',
  description: 'Get random life advice.',
  category: 'Random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { another: 'another' } as const;

export const button = {
  [BUTTON_ID.another]: {
    label: '🔁 Another',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const advice = await fetchAdvice();

    if (!advice) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: '⚠️ **No advice returned.** Please try again later.',
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
        : button.generateID({ id: BUTTON_ID.another, public: true });

    const message = `💡 **Advice:**\n\n_${advice}_`;

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
      message: '⚠️ **Error:** Failed to fetch advice. Please try again later.',
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
