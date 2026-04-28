/**
 * Bible Command
 * Fetches Bible passages or random verses from bible-api.com.
 * Includes a "Switch Translation" button for KJV ↔ WEB toggling.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

const API = {
  BIBLE: 'https://bible-api.com',
  RANDOM: 'https://labs.bible.org/api/?passage=random&type=json',
};

const TIMEOUT = 10000;

export const config: CommandConfig = {
  name: 'bible',
  aliases: ['verse', 'scripture', 'gospel'] as string[],
  version: '1.2.1',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Fetch Bible passages or random verses.',
  category: 'random',
  usage: '[passage] [--version=<ver>]',
  cooldown: 3,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ParsedArgs {
  text: string;
  version: string;
}

function parseArgs(args: string[]): ParsedArgs {
  let version = 'kjv';
  const cleanArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg.startsWith('--version=') || arg.startsWith('-v=')) {
      version = arg.split('=')[1]!;
      continue;
    }

    if ((arg === '--version' || arg === '-v') && args[i + 1]) {
      version = args[i + 1]!;
      i++;
      continue;
    }

    cleanArgs.push(arg);
  }

  return { text: cleanArgs.join(' '), version };
}

interface RandomVerse {
  bookname: string;
  chapter: string;
  verse: string;
}

async function fetchRandomReference(): Promise<string | null> {
  try {
    const { data } = await axios.get<RandomVerse[]>(API.RANDOM, {
      timeout: 8000,
    });
    if (Array.isArray(data) && data[0]) {
      const { bookname, chapter, verse } = data[0];
      return `${bookname} ${chapter}:${verse}`;
    }
  } catch {
    // Silent fail
  }
  return null;
}

interface BibleApiResponse {
  reference?: string;
  translation_name?: string;
  text?: string;
  verses?: Array<{ verse: number; text: string }>;
}

interface BibleFetchResult {
  reference: string;
  translationName: string;
  passageText: string;
}

async function fetchPassage(
  text: string,
  version: string,
): Promise<BibleFetchResult> {
  const url = `${API.BIBLE}/${encodeURIComponent(text)}?translation=${encodeURIComponent(version)}`;
  const { data } = await axios.get<BibleApiResponse>(url, { timeout: TIMEOUT });

  const reference = data.reference ?? text;
  const translationName = data.translation_name ?? version.toUpperCase();

  let passageText = '';
  if (data.text) {
    passageText = data.text.trim();
  } else if (data.verses) {
    passageText = data.verses
      .map((v) => `${v.verse}. ${v.text.trim()}`)
      .join('\n');
  } else {
    passageText = 'No text found.';
  }

  return { reference, translationName, passageText };
}

// ── Button definitions ────────────────────────────────────────────────────────

const BUTTON_ID = { switchVersion: 'switch_version' } as const;

/**
 * The button stores [reference, altVersion] in its context so onClick
 * can fetch and display the alternate translation.
 */
export const button = {
  [BUTTON_ID.switchVersion]: {
    label: '🔄 Switch Translation',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, session, event, button: btn, native }: AppCtx) => {
      const context = session.context as {
        reference?: string;
        altVersion?: string;
      };

      const reference = context.reference ?? '';
      const version = context.altVersion ?? 'WEB';

      try {
        const {
          reference: ref,
          translationName,
          passageText,
        } = await fetchPassage(reference, version);

        // Flip to the other version for the next toggle
        const nextAlt = version.toUpperCase() === 'KJV' ? 'WEB' : 'KJV';
        btn.createContext({
          id: session.id,
          context: { reference: ref, altVersion: nextAlt },
        });
        btn.update({ id: session.id, label: `🔄 Switch to ${nextAlt}` });

        const newMessage =
          `📜 **Scripture**\n` +
          `**${ref}** — _${translationName}_\n\n` +
          `${passageText}`;

        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message:
            newMessage.length > 3800
              ? newMessage.substring(0, 3795) + '...'
              : newMessage,
          ...(hasNativeButtons(native.platform)
            ? { button: [session.id] }
            : {}),
        });
      } catch {
        // If switch fails, silently do nothing — button stays visible for retry
      }
    },
  },
};

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  event,
  native,
  button: btn,
}: AppCtx): Promise<void> => {
  let { text, version } = parseArgs(args);

  // Handle reply context — use quoted message as passage query
  if (!text) {
    const messageReply = event['messageReply'] as
      | Record<string, unknown>
      | undefined;
    if (messageReply?.message) {
      text = messageReply.message as string;
    }
  }

  // Handle random mode
  let isRandom = false;
  if (!text) {
    const randomRef = await fetchRandomReference();
    if (!randomRef) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Could not fetch a random verse. Please provide a passage.',
      });
      return;
    }
    text = randomRef;
    isRandom = true;
  }

  const loadingId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `📖 **Looking up:** ${text} (${version.toUpperCase()})...`,
  });

  try {
    const { reference, translationName, passageText } = await fetchPassage(
      text,
      version,
    );

    const header = isRandom ? '🎯 **Random Verse**' : '📜 **Scripture**';
    const message =
      `${header}\n` +
      `**${reference}** — _${translationName}_\n\n` +
      `${passageText}`;

    // If passage is too long, send as a file
    if (message.length > 3800) {
      const buf = Buffer.from(
        `${reference} (${translationName})\n\n${passageText}`,
        'utf-8',
      );
      if (loadingId) {
        await chat.unsendMessage(loadingId as string).catch(() => {});
      }
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: `📄 **Passage too long** — here is **${reference}** as a file.`,
        attachment: [
          { name: `${reference.replace(/\s/g, '_')}.txt`, stream: buf },
        ],
      });
      return;
    }

    // Register context so the switch-translation button knows what to fetch
    const buttonId = btn.generateID({
      id: BUTTON_ID.switchVersion,
      public: false,
    });
    const altVersion = version.toUpperCase() === 'KJV' ? 'WEB' : 'KJV';
    btn.update({ id: buttonId, label: `🔄 Switch to ${altVersion}` });
    btn.createContext({ id: buttonId, context: { reference, altVersion } });

    if (loadingId) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: loadingId as string,
        message,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    }
  } catch (err) {
    const error = err as {
      response?: { data?: { error?: string } };
      message?: string;
    };
    const errorText =
      error.response?.data?.error ?? error.message ?? 'Unknown error';

    if (loadingId) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: loadingId as string,
        message: `⚠️ **Error:** ${errorText}\n\nTry checking the spelling or the version.`,
      });
    }
  }
};
