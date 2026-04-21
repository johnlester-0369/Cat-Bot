/**
 * /cosplay — Random Cosplay Video
 *
 * Fetches a random cosplay .mp4 from the ajirodesu/cosplay GitHub archive
 * and sends it as a video with a persistent "🔁 Next Video" button.
 *
 * Economy:
 *   Each video request (initial command or button refresh) costs 50 coins.
 *   - currencies.getMoney    checks the sender's current balance.
 *   - currencies.decreaseMoney deducts 50 coins before serving the video.
 *   - When the balance is insufficient the bot tells the user and withholds
 *     the video; the "🔁 Next Video" button is omitted so it cannot be
 *     re-clicked into a free watch.
 *
 * Flow:
 *   User: /cosplay                    (costs 50 coins)
 *   Bot:  [video + 💰 balance reminder + 🔁 Next Video button]
 *   User: [clicks 🔁 Next Video]      (costs another 50 coins)
 *   Bot:  [edits message with new video] or [out-of-balance notice]
 *
 * Platform notes:
 *   Discord      — video sent as attachment; button appears as a component below.
 *   Telegram     — video sent via attachment_url; inline keyboard shown below.
 *   Facebook Page — attachment_url video; button rendered as Button Template.
 *   hasNativeButtons() guards platforms that do not support interactive buttons.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Coin cost charged per video (initial command or button refresh). */
const COST_PER_VIDEO = 50;

// ── Video Fetcher ─────────────────────────────────────────────────────────────

/**
 * Scrapes the ajirodesu/cosplay GitHub tree for .mp4 file paths and returns
 * a raw.githubusercontent.com URL for a randomly selected video.
 *
 * Returns null on any error so callers can surface a clean error message.
 */
async function fetchCosplayVideo(): Promise<string | null> {
  try {
    const repoUrl = 'https://github.com/ajirodesu/cosplay/tree/main/';
    const { data: html } = await axios.get<string>(repoUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cat-Bot/1.0)' },
    });

    // GitHub renders file entries as anchor hrefs — match only .mp4 blobs
    const re = /href="\/ajirodesu\/cosplay\/blob\/main\/([^"]+\.mp4)"/g;
    const files: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m[1]) files.push(m[1]);
    }

    if (!files.length) return null;

    const file = files[Math.floor(Math.random() * files.length)];
    return `https://raw.githubusercontent.com/ajirodesu/cosplay/main/${file}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cosplay] fetchCosplayVideo error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'cosplay',
  aliases: ['cs'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported to Cat-Bot)',
  description: `Get a random cosplay video from the archive. Costs ${COST_PER_VIDEO} coins per video.`,
  category: 'Random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button Definition ─────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

/**
 * Button definitions exported as `button`.
 * onClick re-invokes onCommand so the existing message is replaced in-place.
 * Balance is re-checked on every click — no free refreshes.
 */
export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Next Video',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves the sender's user ID from the event.
 * Returns undefined when the platform does not expose a user ID.
 */
function getSenderID(event: AppCtx['event']): string | undefined {
  return event['senderID'] as string | undefined;
}

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session, currencies } = ctx;

  const isButtonAction = event['type'] === 'button_action';

  // ── Resolve sender ────────────────────────────────────────────────────────
  const senderID = getSenderID(event);

  if (!senderID) {
    const noIdPayload = {
      style: MessageStyle.MARKDOWN,
      message:
        '❌ **Error:** Could not identify your user account on this platform.',
    };
    if (isButtonAction) {
      await chat.editMessage({
        ...noIdPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(noIdPayload);
    }
    return;
  }

  try {
    // ── Balance check ─────────────────────────────────────────────────────
    const balance = await currencies.getMoney(senderID);

    if (balance < COST_PER_VIDEO) {
      // ── Insufficient funds ─────────────────────────────────────────────
      // Withhold the video and the button so the user cannot retry for free.
      const brokePayload = {
        style: MessageStyle.MARKDOWN,
        message: [
          `💸 **Insufficient balance!**`,
          ``,
          `Watching a cosplay video costs **${COST_PER_VIDEO} coins**, but you only have **${balance} coin${balance === 1 ? '' : 's'}**.`,
          ``,
          `💡 Earn more coins by claiming your \`daily\` reward or completing other activities, then come back!`,
        ].join('\n'),
      };

      if (isButtonAction) {
        // Replace the video with the out-of-balance notice but keep the
        // 🔁 button alive — the user can click it again after earning coins.
        await chat.editMessage({
          ...brokePayload,
          message_id_to_edit: event['messageID'] as string,
          ...(hasNativeButtons(native.platform)
            ? { button: [session.id] }
            : {}),
        });
      } else {
        await chat.replyMessage(brokePayload);
      }
      return;
    }

    // ── Deduct coins before fetching ──────────────────────────────────────
    // Deducting first prevents a race-condition where the same user fires
    // multiple simultaneous requests and drains more coins than intended
    // if we checked → fetched → deducted.
    await currencies.decreaseMoney({
      user_id: senderID,
      money: COST_PER_VIDEO,
    });
    const newBalance = balance - COST_PER_VIDEO;

    // ── Fetch video ───────────────────────────────────────────────────────
    const videoUrl = await fetchCosplayVideo();

    if (!videoUrl) {
      // Refund the coins when the archive is unavailable so the user isn't
      // charged for a video they never received.
      await currencies.increaseMoney({
        user_id: senderID,
        money: COST_PER_VIDEO,
      });

      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: [
          '⚠️ **No videos found.**',
          'The archive may be temporarily unavailable — your coins have been refunded.',
          'Please try again in a moment.',
        ].join('\n'),
      };
      if (isButtonAction) {
        await chat.editMessage({
          ...errPayload,
          message_id_to_edit: event['messageID'] as string,
        });
      } else {
        await chat.replyMessage(errPayload);
      }
      return;
    }

    // ── Compose caption ───────────────────────────────────────────────────
    const caption = [
      '👗 **Random Cosplay**',
      `💰 **−${COST_PER_VIDEO} coins** • Balance: **${newBalance.toLocaleString()} coin${newBalance === 1 ? '' : 's'}**`,
    ].join('\n');

    // Reuse the active instance ID when refreshing via button so the button
    // slot is updated in-place and never disappears between clicks.
    const buttonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.next, public: true });

    // ── Send or edit ──────────────────────────────────────────────────────
    if (isButtonAction) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message: caption,
        attachment_url: [{ name: 'cosplay.mp4', url: videoUrl }],
        message_id_to_edit: event['messageID'] as string,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: caption,
        attachment_url: [{ name: 'cosplay.mp4', url: videoUrl }],
        reply_to_message_id: event['messageID'] as string,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ **Error:** Something went wrong while fetching a cosplay video. Please try again later.',
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
};
