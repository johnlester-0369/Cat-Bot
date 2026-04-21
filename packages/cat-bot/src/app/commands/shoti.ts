/**
 * Shoti Command
 * Fetches a random Shoti video from the public API and sends it with metadata.
 * Includes a Refresh button to fetch another video without re-issuing the command.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'shoti',
  aliases: [] as string[],
  version: '2.3.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Fetch a random shoti video.',
  category: 'Random',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
};

interface ShotiResult {
  shotiurl: string;
  username?: string;
  nickname?: string;
  duration?: string | number;
  region?: string;
}

interface ShotiApiResponse {
  result: ShotiResult;
}

const BUTTON_ID = { refresh: 'refresh' } as const;

async function fetchAndSendShoti(ctx: AppCtx): Promise<void> {
  const { chat, native, event, button, session } = ctx;

  try {
    const apiRes = await axios.get<ShotiApiResponse>(
      'https://betadash-api-swordslush-production.up.railway.app/shoti',
    );
    const data = apiRes.data.result;

    const videoUrl = data.shotiurl;
    const username = data.username ?? '𝙽/𝙰';
    const nickname = data.nickname ?? '𝙽/𝙰';
    const duration = data.duration ?? '𝟶';
    const region = data.region ?? '𝚄𝚗𝚔𝚗𝚘𝚠𝚗';

    const videoRes = await axios.get<ArrayBuffer>(videoUrl, {
      responseType: 'arraybuffer',
    });
    const videoBuffer = Buffer.from(videoRes.data);

    const msg =
      `🎬 **SHOTI REPLAY**\n\n` +
      `👤 User: @${username}\n` +
      `📛 Nick: ${nickname}\n` +
      `⏱ Time: ${duration}s\n` +
      `🌍 Region: ${region}`;

    // Reuse active instance ID if triggered via button; generate new one for fresh command
    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.refresh, public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: msg,
      attachment: [{ name: 'shoti.mp4', stream: videoBuffer }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch {
    const errMsg = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **SYSTEM ERROR**\n\nInfo: Unable to process video`,
    };

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...errMsg,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errMsg);
    }
  }
}

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔄 New Shoti',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => fetchAndSendShoti(ctx),
  },
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await fetchAndSendShoti(ctx);
};
