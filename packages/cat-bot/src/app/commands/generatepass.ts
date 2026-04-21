/**
 * Password Generator Command
 * Generates strong passwords based on an optional base word.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'generatepass',
  aliases: ['genpass', 'password'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generates 6 strong passwords based on your input.',
  category: 'tools',
  usage: '[base_word]',
  cooldown: 3,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  num: '0123456789',
  sym: '!@#$%^&*()_',
} as const;

const MODIFICATIONS: Record<string, string> = {
  a: '@',
  e: '3',
  i: '!',
  o: '0',
  s: '$',
};

/** Modifies a character randomly based on common leetspeak. */
function modifyChar(char: string): string {
  return Math.random() < 0.3 && MODIFICATIONS[char]
    ? MODIFICATIONS[char]!
    : char;
}

/** Generates random characters from the full charset. */
function getRandomChars(length: number): string {
  const fullCharset = Object.values(CHARSETS).join('');
  let result = '';
  for (let i = 0; i < length; i++) {
    result += fullCharset[Math.floor(Math.random() * fullCharset.length)];
  }
  return result;
}

/** Shuffles an array in-place (Fisher-Yates) and returns as a string. */
function shuffle(array: string[]): string {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array.join('');
}

/** Core password generation logic. */
function createPassword(base = '', length = 12): string {
  const processed = base
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, Math.floor(length / 2))
    .split('')
    .map(modifyChar);

  const remaining = Math.max(0, length - processed.length);
  const randomPart = getRandomChars(remaining).split('');

  return shuffle([...processed, ...randomPart]);
}

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  usage,
  prefix = '/',
}: AppCtx): Promise<void> => {
  const baseWord = args.join(' ').trim();

  if (!baseWord) {
    usage();
    return;
  }

  try {
    const passwords: string[] = [];
    for (let i = 0; i < 6; i++) {
      passwords.push(`${i + 1}. \`${createPassword(baseWord, 12)}\``);
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `🔐 **Generated Passwords for:** _${baseWord}_\n\n` +
        `${passwords.join('\n')}\n\n` +
        `_Click to copy on mobile._`,
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};
