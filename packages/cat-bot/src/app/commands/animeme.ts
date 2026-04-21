/**
 * /animeme — Random Anime Meme
 *
 * Fetches a random anime meme from Reddit's r/animemes using the meme-api.com endpoint.
 * Includes a "Refresh" button that re-fetches a new meme in-place (no category stored
 * since the source is always the same fixed subreddit).
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetches a random anime meme (URL + title) from meme-api.com. */
async function fetchAnimeme(): Promise<{ url: string; title: string } | null> {
  try {
    const { data } = await axios.get<{ url?: string; title?: string }>(
      'https://meme-api.com/gimme/animemes',
      { timeout: 10000 },
    );
    return data?.url && data?.title
      ? { url: data.url, title: data.title }
      : null;
  } catch {
    return null;
  }
}

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'animeme',
  aliases: ['anime-meme'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'ShawnDesu',
  description: 'Fetch a random anime meme from Reddit.',
  category: 'Anime',
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
    /**
     * Re-fetches a new random anime meme in-place.
     */
    onClick: async (ctx: AppCtx) => {
      await sendAnimeme(ctx);
    },
  },
};

// ── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Shared send/edit logic used by both onCommand (fresh send) and the
 * button onClick (in-place edit). Determines the correct code path by
 * checking `event.type`.
 */
async function sendAnimeme(ctx: AppCtx): Promise<void> {
  const { chat, native, event, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  try {
    const meme = await fetchAnimeme();
    if (!meme) throw new Error('API returned no content.');

    // On a fresh command, generate a new button ID (context is empty because
    // the meme source is fixed — no category needs to be remembered).
    const buttonId = isButtonAction
      ? ctx.session.id
      : (() => {
          const id = btn.generateID({ id: BUTTON_ID.refresh, public: true });
          btn.createContext({ id, context: {} });
          return id;
        })();

    // Derive file extension from URL for a clean attachment name
    const extMatch = meme.url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
    const ext = extMatch?.[1] ?? 'jpg';

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: `**${meme.title}**`,
      attachment_url: [{ name: `animeme.${ext}`, url: meme.url }],
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
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${message}`,
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
  await sendAnimeme(ctx);
};
