/**
 * /showerthoughts — Random Shower Thought with Refresh Button
 *
 * Fetches a random shower thought from the PopCat /v2/showerthoughts endpoint.
 * Displays the thought, its Reddit author, and upvote count. The refresh
 * button edits the message in-place with a new thought.
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
  name: 'showerthoughts',
  aliases: ['showerthought', 'st'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random shower thought from Reddit.',
  category: 'fun',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button Registry ───────────────────────────────────────────────────────────

const BUTTON_ID = { more: 'more' } as const;

export const button = {
  [BUTTON_ID.more]: {
    label: '🔁 More',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      await sendShowerThought(ctx);
    },
  },
};

// ── Core Logic ────────────────────────────────────────────────────────────────

async function sendShowerThought(ctx: AppCtx): Promise<void> {
  const { chat, native, event, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  try {
    const base = createUrl('popcat', '/v2/showerthoughts');
    if (!base) throw new Error('Failed to build Shower Thoughts API URL.');

    const res = await fetch(base);
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const json = (await res.json()) as {
      error: boolean;
      message: { result: string; author: string; upvotes: number };
    };

    if (json.error) throw new Error('API returned an error.');

    const { result, author, upvotes } = json.message;

    const buttonId = isButtonAction
      ? ctx.session.id
      : (() => {
          const id = btn.generateID({ id: BUTTON_ID.more, public: true });
          btn.createContext({ id, context: {} });
          return id;
        })();

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: `🚿 **Shower Thought**\n\n${result}\n\n— u/${author} · 👍 ${upvotes.toLocaleString()}`,
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
  await sendShowerThought(ctx);
};
