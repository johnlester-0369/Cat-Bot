/**
 * labsgen.ts — AI Labs Image Generator (Neo API)
 *
 * Generates a high-quality AI image from a text prompt using the AILabs
 * endpoint on the Neo API provider. The API returns JSON with `result`
 * containing the generated image URL.
 *
 * Premium-only command: permissions: { premium: true } maps cleanly to
 * Role.PREMIUM in Cat-Bot's role system.
 *
 * Usage:
 *   !labsgen anime girl with short blue hair
 *
 * Button: 🔁 Generate Again — re-runs the same prompt on click.
 *
 * ── Conversion gaps flagged ──────────────────────────────────────────────────
 * ❌ ctx.text || ctx.quoted?.text   → args.join(' ') + messageReply fallback.
 * ❌ buttons: [{ text, id }]        → Cat-Bot button.generateID() + export const button.
 * ❌ ctx.used.prefix + ctx.used.command → prefix + config.name used.
 * ❌ tools.cmd.handleError          → Standard try/catch used.
 * ❌ formatter.bold()               → **Markdown** used directly.
 * ✅ permissions: { premium: true } → Role.PREMIUM (direct equivalent in Cat-Bot).
 *
 * API provider:
 *   neo  /api/ai-image/ailabs  → JSON { result: string (image URL) }
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'labsgen',
  aliases: ['ailabs', 'labs'] as string[],
  version: '1.0.0',
  // permissions: { premium: true } → Role.PREMIUM is the direct Cat-Bot equivalent.
  // The engine enforces this before onCommand runs — no boilerplate needed inside.
  role: Role.PREMIUM,
  author: 'AjiroDesu',
  description: 'Generate a premium AI image using AILabs (Neo API). Premium users only.',
  category: 'AI Generate',
  usage: '<prompt>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Response shape ────────────────────────────────────────────────────────────

interface NeoAILabsResponse {
  result: string; // image URL
}

// ── Button ────────────────────────────────────────────────────────────────────

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

// ── Core logic ────────────────────────────────────────────────────────────────

async function generateAndSend(ctx: AppCtx, prompt: string): Promise<void> {
  const { chat, native, event, button: btn, session } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  let loadingId: string | undefined;
  if (!isButtonAction) {
    loadingId = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🎨 **Generating premium image...**\nPlease wait a moment.',
    })) as string | undefined;
  }

  try {
    const apiUrl = createUrl('neo', '/api/ai-image/ailabs', { prompt });
    if (!apiUrl) throw new Error('Failed to build API URL.');

    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`API responded with status ${res.status}`);

    const data = (await res.json()) as NeoAILabsResponse;
    const imageUrl = data?.result;
    if (!imageUrl) throw new Error('API returned no image URL.');

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
      attachment_url: [{ name: 'labsgen.png', url: imageUrl }],
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

// ── Entry point ───────────────────────────────────────────────────────────────

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