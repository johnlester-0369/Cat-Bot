/**
 * deepgen.ts — DeepAI Image Generator
 *
 * Generates an AI image from a text prompt using the DeepAI endpoint
 * on the Neo API provider. The endpoint streams the image binary directly
 * (no JSON body — same pattern as gemmy.ts in the Cat-Bot repo).
 *
 * Usage:
 *   !deepgen anime girl with short blue hair
 *
 * Coin cost: 5 per use.
 * Button: 🔁 Generate Again — re-runs the same prompt on click.
 *
 * ── Conversion gaps flagged ──────────────────────────────────────────────────
 * ❌ ctx.text || ctx.quoted?.text   → args.join(' ') + messageReply fallback.
 * ❌ buttons: [{ text, id }]        → Cat-Bot button.generateID() + export const button.
 * ❌ ctx.used.prefix + ctx.used.command → prefix + config.name used.
 * ❌ tools.cmd.handleError          → Standard try/catch used.
 * ❌ formatter.bold()               → **Markdown** used directly.
 * ❌ permissions: { coin: 5 }       → Not a config field. Enforced via currencies manually.
 *
 * API provider:
 *   neo  /api/ai-image/deepai  (streams image binary — arraybuffer fetch)
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'deepgen',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate an AI image from a text prompt using DeepAI (Neo API).',
  category: 'AI Generate',
  usage: '<prompt>',
  cooldown: 10,
  hasPrefix: true,
};

const BUTTON_ID = { again: 'again' } as const;

export const button = {
  [BUTTON_ID.again]: {
    label: '🔁 Generate Again',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      const prompt = (ctx.session.context['prompt'] as string | undefined) ?? '';
      if (!prompt) {
        await ctx.chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '⚠️ Could not recover the original prompt. Please re-run the command.',
        });
        return;
      }
      await generateAndSend(ctx, prompt);
    },
  },
};

async function generateAndSend(ctx: AppCtx, prompt: string): Promise<void> {
  const { chat, native, event, button: btn, session, currencies } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  // Coin gate only on fresh command, not on button re-trigger
  if (!isButtonAction) {
    const senderID = event['senderID'] as string;
    const balance = await currencies.getMoney(senderID);
    if (balance < 5) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ You need at least **5 coins** to use this command.\nYour balance: **${balance} coins**`,
      });
      return;
    }
    await currencies.decreaseMoney({ user_id: senderID, money: 5 });
  }

  let loadingId: string | undefined;
  if (!isButtonAction) {
    loadingId = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🎨 **Generating image...**\nPlease wait a moment.',
    })) as string | undefined;
  }

  try {
    // neo /api/ai-image/deepai streams image binary directly
    const imageUrl = createUrl('neo', '/api/ai-image/deepai', { prompt });
    if (!imageUrl) throw new Error('Failed to build API URL.');

    const { data: imageData } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    const imageBuffer = Buffer.from(imageData);

    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

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
      attachment: [{ name: 'deepgen.png', stream: imageBuffer }],
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
      await chat.editMessage({ ...errPayload, message_id_to_edit: event['messageID'] as string });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
}

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const directText = ctx.args.join(' ').trim();
  const quotedText = (
    (ctx.event['messageReply'] as Record<string, unknown> | undefined)?.['message'] as
      | string
      | undefined
  )?.trim();
  const input = directText || quotedText;
  if (!input) return ctx.usage();
  await generateAndSend(ctx, input);
};