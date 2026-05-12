import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

const SIM_COLLECTION = 'sim_memory';

/** Word‑by‑word similarity (returns percentage 0‑1) */
function similarity(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const matches = wordsA.filter((w) => wordsB.includes(w));
  const ratio = matches.length / Math.max(wordsA.length, wordsB.length);
  return ratio;
}

export const config: CommandConfig = {
  name: 'sim',
  aliases: ['simi', 'teach'],
  version: '1.0.0',
  description:
    'Local Sim command that learns answers (no API). Syntax: sim <ask> or sim teach <ask> | <answer>',
  category: 'AI',
  hasPrefix: true,
  cooldown: 1,
  options: [
    {
      type: OptionType.string,
      name: 'text',
      description: 'Question, or "teach <q> | <a>"',
      required: false,
    },
  ],
};

export const onCommand = async ({ chat, args, db }: AppCtx): Promise<void> => {
  const input = args.join(' ').trim();
  if (!input) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: 'Usage:\n`sim <ask>`\n`sim teach <ask> | <answer>`',
    });
    return;
  }

  // ensure collection exists
  const collExist = await db.bot.isCollectionExist(SIM_COLLECTION);
  if (!collExist) await db.bot.createCollection(SIM_COLLECTION);
  const simColl = await db.bot.getCollection(SIM_COLLECTION);

  /** ---- TEACH MODE ---- **/
  if (input.toLowerCase().startsWith('teach ')) {
    const payload = input.slice(6).trim();
    const [ask, ans] = payload.split('|').map((s) => s.trim());
    if (!ask || !ans) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Invalid format.\nUse: `sim teach <ask> | <answer>`',
      });
      return;
    }
    await simColl.set(ask.toLowerCase(), ans);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Learned:\n**Q:** ${ask}\n**A:** ${ans}`,
    });
    return;
  }

  /** ---- ASK MODE ---- **/
  const allKeys = await simColl.getAllKeys();
  if (!allKeys || allKeys.length === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '💤 I don’t know anything yet. Teach me using `sim teach <ask> | <answer>`',
    });
    return;
  }

  let bestKey = '';
  let bestScore = 0;
  for (const key of allKeys) {
    const score = similarity(key, input);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestScore === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🤔 I have no idea. Try teaching me!',
    });
    return;
  }

  const answer = await simColl.get(bestKey);
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `💬 ${String(answer)}`,
  });
};

