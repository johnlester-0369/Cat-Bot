/**
 * /girl — Random Girl Image (Indonesia / China / Korea / Thailand / Vietnam / Japan)
 *
 * Uses the centralized `createUrl` helper (rynekoo registry).
 * Randomly selects one of the 6 countries on every request.
 * Fetches the actual image as a Buffer and sends it via attachment stream.
 * Refresh button always gives a new random country + new image.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

type CountryCode = 'indonesia' | 'china' | 'korea' | 'thailand' | 'vietnam' | 'japan';

const COUNTRIES: CountryCode[] = ['indonesia', 'china', 'korea', 'thailand', 'vietnam', 'japan'];

const DISPLAY_NAMES: Record<CountryCode, string> = {
  indonesia: 'Indonesian',
  china: 'Chinese',
  korea: 'Korean',
  thailand: 'Thai',
  vietnam: 'Vietnamese',
  japan: 'Japanese',
};

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'girl',
  aliases: ['randomgirl', 'girlimg', 'asiangirl'] as string[],
  version: '2.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Fetch a random girl image from Indonesia, China, Korea, Thailand, Vietnam or Japan.',
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
      await sendRandomGirl(ctx);
    },
  },
};

// ── Core Logic ────────────────────────────────────────────────────────────────

async function sendRandomGirl(ctx: AppCtx): Promise<void> {
  const { chat, native, event, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  try {
    const country = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)] as CountryCode;
    const path = `/random/girl/${country}`;

    const url = createUrl('nekolabs', path);
    if (!url) throw new Error('Failed to build Girl API URL.');

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
      message: `**🌍 Random ${DISPLAY_NAMES[country]} Girl Image**`,
      attachment: [{ name: `girl-${country}.jpg`, stream: imageBuffer }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      // Use replyMessage so the response is properly threaded to the command message
      await chat.replyMessage(payload);
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
      // Use replyMessage so the error is threaded to the command message
      await chat.replyMessage(errPayload);
    }
  }
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await sendRandomGirl(ctx);
};