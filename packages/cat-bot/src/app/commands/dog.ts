/**
 * /dog — Random Dog Image
 *
 * Fetches a random dog image from the Dog CEO API and sends it as an image
 * attachment with a persistent "🔁 Woof Again" button.
 *
 * Flow:
 *   User: /dog
 *   Bot:  [dog image + caption + 🔁 Woof Again button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Woof Again]
 *   Bot:  [edits the same message with a fresh dog image — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchDog(): Promise<string | null> {
  try {
    const { data } = await axios.get(
      'https://dog.ceo/api/breeds/image/random',
      {
        headers: { Accept: 'application/json' },
        timeout: 10000,
      },
    );
    return (data?.message as string) || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dog] fetchDog error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'dog',
  aliases: ['dogpic', 'dogimage', 'puppy'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported to Cat-Bot)',
  description: 'Send a random dog image.',
  category: 'Random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Woof Again',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const imageUrl = await fetchDog();

    if (!imageUrl) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: '⚠️ **Error:** Could not retrieve a dog image.',
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

    // Derive the file extension so MIME detection works correctly on all platforms
    const extMatch = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1] : 'jpg';

    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.next, public: true });

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message: '🐕 **Random Dog Image**',
        attachment_url: [{ name: `dog.${ext}`, url: imageUrl }],
        message_id_to_edit: event['messageID'] as string,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🐕 **Random Dog Image**',
        attachment_url: [{ name: `dog.${ext}`, url: imageUrl }],
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ **System Error:** Failed to fetch a dog image. Please try again later.',
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
