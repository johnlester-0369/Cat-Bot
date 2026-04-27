/**
 * /wyr — Would You Rather with Refresh Button
 *
 * Fetches a random "Would You Rather" prompt from the PopCat /v2/wyr endpoint.
 * The refresh button edits the message in-place with a new prompt.
 *
 * ⚠️  `createUrl` registry name 'popcat' is assumed — confirm with the
 *     Cat Bot engine team that this registry key exists.
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
  name: 'wyr',
  aliases: ['wouldyourather'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random "Would You Rather" question.',
  category: 'fun',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button Registry ───────────────────────────────────────────────────────────

const BUTTON_ID = { another: 'another' } as const;

export const button = {
  [BUTTON_ID.another]: {
    label: '🔄 Another One',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      await sendWyr(ctx);
    },
  },
};

// ── Core Logic ────────────────────────────────────────────────────────────────

async function sendWyr(ctx: AppCtx): Promise<void> {
  const { chat, native, event, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  try {
    const base = createUrl('popcat', '/v2/wyr');
    if (!base) throw new Error('Failed to build WYR API URL.');

    const res = await fetch(base);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const json = (await res.json()) as {
      error: boolean;
      message: { ops1: string; ops2: string };
    };

    if (json.error) throw new Error('API returned an error.');

    const { ops1, ops2 } = json.message;

    const buttonId = isButtonAction
      ? ctx.session.id
      : (() => {
          const id = btn.generateID({ id: BUTTON_ID.another, public: true });
          btn.createContext({ id, context: {} });
          return id;
        })();

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: `🤔 **Would You Rather...**\n\n🅰️ ${ops1}\n\n**— OR —**\n\n🅱️ ${ops2}`,
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
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
      await chat.replyMessage(errPayload);
    }
  }
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await sendWyr(ctx);
};
