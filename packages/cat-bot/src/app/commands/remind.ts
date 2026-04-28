/**
 * Remind Command
 * Set a timed reminder. Supports both command syntax and natural language via onChat.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'remind',
  aliases: ['reminder', 'remindme'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Set a reminder. Supports natural language too.',
  category: 'tools',
  usage: '<5s|10m|2h|1d> <message>',
  cooldown: 3,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIME_MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const NATURAL_MULTIPLIERS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

function parseTime(str: string): number | null {
  const m = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const multiplier = TIME_MULTIPLIERS[m[2]!.toLowerCase()];
  return multiplier !== undefined ? parseInt(m[1]!, 10) * multiplier : null;
}

/**
 * Schedules a reminder by using chat.reply() with the captured threadID.
 * This sends directly to the originating thread after the delay.
 */
function scheduleReminder(
  chat: AppCtx['chat'],
  threadID: string,
  text: string,
  ms: number,
): void {
  setTimeout(async () => {
    try {
      await chat.reply({
        thread_id: threadID,
        style: MessageStyle.MARKDOWN,
        message: `⏰ **Reminder!**\n📝 ${text}`,
      });
    } catch (e) {
      console.error('[remind] Failed to deliver:', (e as Error).message);
    }
  }, ms);
}

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  event,
  usage,
  prefix = '/',
}: AppCtx): Promise<void> => {
  if (args.length < 2) {
    await usage();
    return;
  }

  const ms = parseTime(args[0]!);
  const text = args.slice(1).join(' ');
  const threadID = event['threadID'] as string;

  if (!ms) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Invalid time format.\nExamples: `5s`, `10m`, `2h`, `1d`',
    });
    return;
  }

  if (ms > 86_400_000 * 7) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Maximum reminder duration is **7 days**.',
    });
    return;
  }

  if (!text.trim()) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Please provide a reminder message.',
    });
    return;
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `✅ Reminder set for **${args[0]}**!\n📝 *${text}*`,
  });

  scheduleReminder(chat, threadID, text, ms);
};

// ── onChat — natural language: "remind me to X in N minutes" ─────────────────

export const onChat = async ({ event, chat }: AppCtx): Promise<void> => {
  const message = event['message'] as string | undefined;
  if (!message) return;

  const m = message.match(
    /remind me (?:to )?(.*?) in (\d+)\s*(second|minute|hour|day)s?/i,
  );
  if (!m) return;

  const text = m[1]!.trim();
  const value = parseInt(m[2]!, 10);
  const unit = m[3]!.toLowerCase();
  const multiplier = NATURAL_MULTIPLIERS[unit];
  const ms = multiplier !== undefined ? value * multiplier : 0;

  if (!ms || ms > 86_400_000 * 7) return;

  const threadID = event['threadID'] as string;

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `✅ Got it! Reminding you to *${text}* in **${value} ${unit}${value !== 1 ? 's' : ''}**.`,
  });

  scheduleReminder(chat, threadID, text, ms);
};
