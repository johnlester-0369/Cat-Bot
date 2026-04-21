/**
 * Detect Command
 * Passively detects keywords and notifies bot admins via private DM.
 * onCommand: BOT_ADMIN only status check.
 * onChat: passive listener, open to all messages.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { listBotAdmins } from '@/engine/repos/credentials.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'detect',
  aliases: [] as string[],
  version: '1.2.0',
  role: Role.BOT_ADMIN,
  author: 'AjiroDesu',
  description: 'Passively detects keywords and notifies bot admins via DM.',
  category: 'Hidden',
  usage: '',
  cooldown: 0,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── Keywords to watch ─────────────────────────────────────────────────────────

const KEYWORDS = ['lance'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escape MarkdownV2 special characters so raw user text never breaks
 * the bot's formatted alert message.
 */
function escapeMd(text: string): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Build a whole-word, case-insensitive RegExp for a keyword.
 * Falls back to null if the keyword contains characters that break the regex.
 */
function makePattern(kw: string): RegExp | null {
  try {
    return new RegExp(`\\b${kw}\\b`, 'i');
  } catch {
    return null;
  }
}

// Build patterns once at module load
const PATTERNS: Record<string, RegExp | null> = Object.fromEntries(
  KEYWORDS.map((kw) => [kw, makePattern(kw)]),
);

// ── onCommand — admin status check ───────────────────────────────────────────

export const onCommand = async ({ chat }: AppCtx): Promise<void> => {
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      `🛡️ **Detection System Online**\n` +
      `Watching for: _${KEYWORDS.map(escapeMd).join(', ')}_`,
  });
};

// ── onChat — passive keyword scanner ─────────────────────────────────────────

export const onChat = async ({
  event,
  chat,
  native,
}: AppCtx): Promise<void> => {
  const message = event['message'] as string | undefined;
  if (!message) return;

  const from = event['senderID'] as string | undefined;
  if (!from) return;

  // Find every keyword that appears in the message
  const detected = KEYWORDS.filter((kw) => {
    const pattern = PATTERNS[kw];
    return pattern
      ? pattern.test(message)
      : message.toLowerCase().includes(kw.toLowerCase());
  });

  if (!detected.length) return;

  // Build report metadata
  const threadID = event['threadID'] as string;
  const isGroup = event['isGroup'] as boolean | undefined;
  const senderID = event['senderID'] as string;
  const messageID = event['messageID'] as string | undefined;

  const chatLabel = isGroup
    ? `Group \`${threadID}\``
    : `Private Chat \`${threadID}\``;
  const keywords = detected.map((k) => `\`${k}\``).join(', ');
  const safeBody = escapeMd(message);

  const report =
    `🚨 *Keyword Detected: ${keywords}*\n\n` +
    `*Chat Details:*\n` +
    `• Type: ${chatLabel}\n\n` +
    `*User Details:*\n` +
    `• User ID: \`${senderID}\`\n\n` +
    `*Message Details:*\n` +
    `• Message ID: \`${messageID ?? 'N/A'}\`\n` +
    `• Content:\n\n` +
    `_${safeBody}_`;

  // Resolve session coordinates from native context
  const { userId, platform, sessionId } = native;

  // Guard: session identity required to look up admins
  if (!userId || !platform || !sessionId) {
    console.error(
      '[detect] Missing session identity — cannot resolve admin list.',
    );
    return;
  }

  // Fetch all bot admins for this session
  let adminIds: string[];
  try {
    adminIds = await listBotAdmins(userId, platform, sessionId);
  } catch (err) {
    console.error(
      '[detect] Failed to fetch admin list:',
      (err as Error).message,
    );
    return;
  }

  if (!adminIds.length) return;

  // Send alert as a private DM to every bot admin.
  // chat.reply() with thread_id set to the admin's user ID opens / targets their
  // 1-on-1 DM thread — the same pattern used by sendnoti.ts for group broadcasts.
  for (const adminId of adminIds) {
    try {
      await chat.reply({
        thread_id: adminId,
        style: MessageStyle.MARKDOWN,
        message: report,
      });
    } catch (err) {
      console.error(
        `[detect] Failed to DM admin ${adminId}:`,
        (err as Error).message,
      );
    }
  }
};
