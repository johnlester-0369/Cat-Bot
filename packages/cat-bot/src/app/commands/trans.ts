import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'trans',
  aliases: ['translate'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Translate text to a specific language',
  category: 'Media',
  usage: '<text> | <lang> (or reply: | <lang>)',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'input',
      description: 'Text and language code separated by | (e.g., "Ciao | en")',
      required: true,
    },
  ],
};

export const onCommand = async ({
  chat,
  event,
  args,
  prefix = '',
}: AppCtx): Promise<void> => {
  let lang = 'en'; // Default target language
  let text = '';

  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;

  // Split on the first '|' to resolve "<text> | <lang>" — pipe unambiguously separates
  // multi-word text from the language code without relying on character-length heuristics.
  const rawInput = args.join(' ');
  const pipeIndex = rawInput.indexOf('|');
  const hasPipe = pipeIndex !== -1;
  const beforePipe = hasPipe
    ? rawInput.slice(0, pipeIndex).trim()
    : rawInput.trim();
  const afterPipe = hasPipe ? rawInput.slice(pipeIndex + 1).trim() : '';

  if (messageReply) {
    const replyMsg = (messageReply['message'] as string) || '';
    // Reply path: the pipe specifies the target language only (e.g., "| vi").
    // Without a pipe, the entire input is treated as the lang code (backward-compat shortcut).
    lang = hasPipe ? afterPipe || 'en' : rawInput.trim() || 'en';
    text = replyMsg;
  } else {
    // Non-reply path: text is required on the left side of the pipe.
    if (!beforePipe) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}trans <text> | <lang>\nExample: ${prefix}trans Hello | vi`,
      });
      return;
    }
    text = beforePipe;
    lang = afterPipe || 'en';
  }

  if (!text.trim()) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ No text provided to translate.',
    });
    return;
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
    const { data } = await axios.get(url);

    // Google Translate API returns a nested array where data[0] contains the translation blocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const translatedText = data[0].map((item: any) => item[0]).join('');
    const sourceLang = data[2] || 'unknown';

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**Translation:** ${translatedText}\n_Translated from ${sourceLang} to ${lang}_`,
    });
  } catch (error) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ An error occurred while translating. The service might be temporarily unavailable.',
    });
  }
};
