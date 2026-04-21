/**
 * /waifu — Random Anime Picture
 *
 * Fetches a random anime-style image from the waifu.pics SFW API.
 * Supports 31 categories and includes a "Refresh" button that re-fetches
 * the same category in-place by reading the stored button context.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'waifu',
  'neko',
  'shinobu',
  'megumin',
  'bully',
  'cuddle',
  'cry',
  'hug',
  'awoo',
  'kiss',
  'lick',
  'pat',
  'smug',
  'bonk',
  'yeet',
  'blush',
  'smile',
  'wave',
  'highfive',
  'handhold',
  'nom',
  'bite',
  'glomp',
  'slap',
  'kill',
  'kick',
  'happy',
  'wink',
  'poke',
  'dance',
  'cringe',
] as const;

type WaifuCategory = (typeof CATEGORIES)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Capitalizes the first letter of a string for display. */
const toTitleCase = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1);

/** Fetches a random image URL for the given SFW category from waifu.pics. */
async function fetchWaifu(category: string): Promise<string | null> {
  try {
    const { data } = await axios.get<{ url?: string }>(
      `https://api.waifu.pics/sfw/${category}`,
      { timeout: 10000 },
    );
    return data?.url ?? null;
  } catch {
    return null;
  }
}

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'waifu',
  aliases: ['waifupic', 'waifuphoto'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'ShawnDesu',
  description: 'Get a random anime picture by category.',
  category: 'Anime',
  usage: '[category] | list',
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
     * Re-fetches the same category that was stored via button.createContext()
     * at the time the command originally ran.
     */
    onClick: async (ctx: AppCtx) => {
      const category =
        (ctx.session.context['category'] as string | undefined) ?? 'waifu';
      await sendWaifuImage(ctx, category);
    },
  },
};

// ── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Shared send/edit logic used by both onCommand (fresh send) and the
 * button onClick (in-place edit).  Determines the correct code path by
 * checking `event.type`.
 */
async function sendWaifuImage(ctx: AppCtx, category: string): Promise<void> {
  const { chat, native, event, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  try {
    const url = await fetchWaifu(category);
    if (!url) throw new Error('API returned no image.');

    // On a fresh command, generate a new button ID and store the category
    // so the onClick handler can restore it on subsequent refreshes.
    const buttonId = isButtonAction
      ? ctx.session.id
      : (() => {
          const id = btn.generateID({ id: BUTTON_ID.refresh, public: true });
          btn.createContext({ id, context: { category } });
          return id;
        })();

    // Derive file extension from URL for a clean attachment name
    const extMatch = url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
    const ext = extMatch?.[1] ?? 'jpg';

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: `✨ **${toTitleCase(category)}**`,
      attachment_url: [{ name: `waifu_${category}.${ext}`, url }],
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
  const { args, chat, prefix = '/' } = ctx;
  const arg = (args[0] ?? 'waifu').toLowerCase();

  // 1. Show category list
  if (['list', 'help', 'categories'].includes(arg)) {
    const list = CATEGORIES.map((c) => `\`${c}\``).join(', ');
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `📂 **Available Categories:**\n\n${list}`,
    });
    return;
  }

  // 2. Validate category
  if (!(CATEGORIES as readonly string[]).includes(arg)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Invalid Category**\nCategory \`${arg}\` does not exist.\nUse \`${prefix}waifu list\` to see all options.`,
    });
    return;
  }

  // 3. Fetch and send
  await sendWaifuImage(ctx, arg as WaifuCategory);
};
