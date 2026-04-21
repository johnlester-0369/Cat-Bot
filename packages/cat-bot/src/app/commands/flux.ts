/**
 * Flux AI Image Generator
 *
 * Generates a high-quality AI image from a text prompt using the
 * DeepImg endpoint on the Kuroneko (danzy.web.id) API.
 *
 * Usage:
 *   !flux anime girl with short blue hair
 *   !flux cyberpunk city at night
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeepImgResponse {
  result: {
    image: string;
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'flux',
  aliases: ['deepimg', 'fluxai'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate an AI image from a text prompt using DeepImg (Flux).',
  category: 'AI Generate',
  usage: '<prompt>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Button Registry ───────────────────────────────────────────────────────────

const BUTTON_ID = { again: 'again' } as const;

// ── Button Handlers ───────────────────────────────────────────────────────────

export const button = {
  [BUTTON_ID.again]: {
    label: '🔁 Generate Again',
    style: ButtonStyle.PRIMARY,
    /**
     * Prompt is stored in button context via btn.createContext() at command time.
     * ctx.session.context restores it here on every button click.
     */
    onClick: async (ctx: AppCtx) => {
      const prompt =
        (ctx.session.context['prompt'] as string | undefined) ?? '';
      if (!prompt) {
        await ctx.chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message:
            '⚠️ Could not recover the original prompt. Please re-run the command.',
        });
        return;
      }
      await generateAndSend(ctx, prompt);
    },
  },
};

// ── Core Logic ────────────────────────────────────────────────────────────────

async function generateAndSend(ctx: AppCtx, prompt: string): Promise<void> {
  const { chat, native, event, button: btn, session } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  let loadingId: string | undefined;
  if (!isButtonAction) {
    loadingId = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🎨 **Generating image...**\nPlease wait a moment.',
    })) as string | undefined;
  }

  try {
    const apiUrl = createUrl('kuroneko', '/api/ai/deepimg', { prompt });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const { data } = await axios.get<DeepImgResponse>(apiUrl, {
      timeout: 60000,
    });
    const imageUrl = data?.result?.image;
    if (!imageUrl) throw new Error('No image returned from API.');

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    // Fresh command → register a new button instance and persist the prompt
    // so onClick can re-invoke with the same value.
    const buttonId = isButtonAction
      ? session.id
      : (() => {
          const id = btn.generateID({ id: BUTTON_ID.again, public: true });
          btn.createContext({ id, context: { prompt } });
          return id;
        })();

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: `✨ **Prompt:** ${prompt}`,
      attachment_url: [{ name: 'flux.png', url: imageUrl }],
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
      message: `❌ **Failed to generate image.**\n\`${error.message ?? 'Unknown error'}\``,
    };

    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

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

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  if (!ctx.args.length) {
    await ctx.usage();
    return;
  }
  await generateAndSend(ctx, ctx.args.join(' '));
};
