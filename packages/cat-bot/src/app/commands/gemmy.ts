/**
 * Gemmy AI Image Generator
 *
 * Generates an AI image from a text prompt using the Gemmy endpoint
 * on the NeoAPIs (neoapis.xyz) provider. The endpoint returns the image
 * binary directly when fetched, rather than wrapping it in JSON.
 *
 * Usage:
 *   !gemmy anime girl with short blue hair
 *   !gemmy futuristic cityscape at sunset
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'gemmy',
  aliases: ['gemmyai', 'neoimg'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate an AI image from a text prompt using Gemmy (NeoAPIs).',
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
    // createUrl builds the fully-qualified endpoint; the Neo Gemmy endpoint
    // streams the image binary directly — no JSON body to unwrap.
    const imageUrl = createUrl('neo', '/api/ai-image/gemmy', { prompt });
    if (!imageUrl) throw new Error('Failed to build API URL.');

    const { data: imageData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    const imageBuffer = Buffer.from(imageData);

    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

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
      attachment: [{ name: 'gemmy.png', stream: imageBuffer }],
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
