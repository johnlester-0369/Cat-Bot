/**
 * /meme — Random Meme Fetcher
 *
 * Fetches a random meme from the public meme-api.com endpoint and sends
 * it with a 🔄 Refresh button so users can keep scrolling without
 * re-typing the command.  The refresh re-fetches in place, replacing
 * the current image to keep the chat tidy.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

interface MemeResult {
  url: string;
  title: string;
}

async function fetchMeme(): Promise<MemeResult> {
  const { data } = await axios.get('https://meme-api.com/gimme/memes', {
    timeout: 10000,
  });
  if (!data?.url || !data?.title) throw new Error('Invalid meme data returned');
  return { url: data.url as string, title: data.title as string };
}

export const config: CommandConfig = {
  name: 'meme',
  aliases: ['memes', 'randommeme'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'ShawnDesu',
  description: 'Sends a random meme.',
  category: 'Random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

const BUTTON_ID = { refresh: 'refresh' } as const;

/**
 * Core handler shared by the initial command and the Refresh button onClick.
 * When triggered via a button click the existing message is edited in-place;
 * otherwise a fresh reply is sent.
 */
export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, event, native, button, session } = ctx;
  const isRefresh = event['type'] === 'button_action';

  try {
    const meme = await fetchMeme();

    // Reuse the active button instance ID on refresh so the button stays live.
    const buttonId = isRefresh
      ? session.id
      : button.generateID({ id: BUTTON_ID.refresh, public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: `😂 **${meme.title}**`,
      attachment_url: [{ name: 'meme.jpg', url: meme.url }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (isRefresh) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: '⚠️ Failed to fetch a meme. Please try again.',
    };
    if (isRefresh) {
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
};

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔄 Next Meme',
    style: ButtonStyle.PRIMARY,
    onClick: (ctx: AppCtx) => onCommand(ctx),
  },
};
