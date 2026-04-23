/**
 * /randomcat — Random Cat Image (Updated)
 *
 * Now uses the centralized `createUrl` helper (rynekoo registry).
 * Fetches the actual image as a Buffer and sends it via attachment stream.
 * Refresh button always gives a brand-new random cat.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'cat',
  aliases: ['kitty', 'meow'] as string[],
  version: '2.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Fetch a random cat image (direct image response).',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button Registry ───────────────────────────────────────────────────────────

const BUTTON_ID = { refresh: 'refresh' } as const;

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔁 Refresh',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      await sendRandomCat(ctx);
    },
  },
};

// ── Core Logic ────────────────────────────────────────────────────────────────

async function sendRandomCat(ctx: AppCtx): Promise<void> {
  const { chat, native, event, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  try {
    const url = createUrl('nekolabs', '/random/cat');
    if (!url) throw new Error('Failed to build Random Cat API URL.');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const arrayBuffer = await res.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const buttonId = isButtonAction
      ? ctx.session.id
      : (() => {
          const id = btn.generateID({ id: BUTTON_ID.refresh, public: true });
          btn.createContext({ id, context: {} });
          return id;
        })();

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: '**🐱 Random Cat Image**',
      attachment: [{ name: 'randomcat.jpg', stream: imageBuffer }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.reply(payload);
    }
  } catch (err) {
    const error = err as { message?: string };
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.reply(errPayload);
    }
  }
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await sendRandomCat(ctx);
};