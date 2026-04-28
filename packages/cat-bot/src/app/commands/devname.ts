/**
 * Developer Username Generator
 * Generates creative usernames based on different tech styles.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'devname',
  aliases: ['devnick', 'devuser'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'JohnDev19',
  description: 'Generate cool developer usernames.',
  category: 'tools',
  usage: '[name] [style]',
  cooldown: 3,
  hasPrefix: true,
};

// ── Data ──────────────────────────────────────────────────────────────────────

const PREFIXES = [
  'cyber',
  'tech',
  'code',
  'dev',
  'hack',
  'byte',
  'pixel',
  'data',
  'web',
  'net',
  'algo',
  'script',
  'logic',
  'proto',
  'meta',
  'digital',
  'binary',
  'quantum',
  'neural',
  'crypto',
  'machine',
  'cloud',
  'zero',
  'stack',
  'core',
  'spark',
  'prime',
  'matrix',
  'flux',
  'nano',
  'system',
  'micro',
  'intel',
  'async',
  'sync',
  'root',
  'admin',
  'kernel',
  'lambda',
  'debug',
  'circuit',
  'network',
  'stream',
  'buffer',
  'cache',
  'block',
  'thread',
  'signal',
  'proxy',
  'pulse',
  'blade',
  'bolt',
  'drone',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'echo',
  'omega',
  'ai',
  'ml',
  'deep',
  'learn',
  'brain',
  'smart',
  'compute',
  'daemon',
  'router',
  'server',
  'client',
  'host',
];

const SUFFIXES = [
  'warrior',
  'champion',
  'elite',
  'legend',
  'titan',
  'phoenix',
  'dragon',
  'wolf',
  'hawk',
  'fox',
  'knight',
  'samurai',
  'ranger',
  'sentinel',
  'guardian',
  'shield',
  'blade',
  'storm',
  'thunder',
  'master',
  'sage',
  'guru',
  'sensei',
  'oracle',
  'seer',
  'architect',
  'hunter',
  'scout',
  'slayer',
  'breaker',
  'crusher',
  'spark',
  'flame',
  'blaze',
  'inferno',
  'nova',
  'star',
  'comet',
  'rocket',
  'prime',
];

const TECH_STACK = [
  'git',
  'node',
  'react',
  'vue',
  'rust',
  'java',
  'py',
  'go',
  'ruby',
  'swift',
  'docker',
  'k8s',
  'nginx',
  'redis',
  'mongo',
  'graphql',
  'ts',
  'js',
  'dart',
  'elixir',
  'svelte',
  'next',
  'nuxt',
  'django',
  'flask',
  'aws',
  'azure',
  'linux',
  'arch',
  'bash',
];

const LEET_MAP: Record<string, string> = {
  a: '4',
  e: '3',
  i: '1',
  o: '0',
  s: '5',
  t: '7',
  b: '8',
  g: '9',
};

// ── Generators ────────────────────────────────────────────────────────────────

const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const randNum = (max = 999): number => Math.floor(Math.random() * (max + 1));

const generators: Record<string, (name: string, count: number) => string[]> = {
  classic: (name, count) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(`${rand(PREFIXES)}${name}${rand(SUFFIXES)}`);
    }
    return out;
  },

  leet: (name, count) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      let leet = name.toLowerCase();
      Object.entries(LEET_MAP).forEach(([k, v]) => {
        if (Math.random() > 0.5) leet = leet.replace(new RegExp(k, 'g'), v);
      });
      out.push(`${rand(PREFIXES)}_${leet}_${randNum()}`);
    }
    return out;
  },

  minimalist: (name, count) => {
    const base = name.toLowerCase();
    const noVowels = base.replace(/[aeiou]/g, '') || base;
    return [
      `_${base}_`,
      `-${base}-`,
      `.${base}.`,
      `_${noVowels}_`,
      `-${noVowels}-`,
      `.${noVowels}.`,
    ].slice(0, count);
  },

  tech: (name, count) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const tech = rand(TECH_STACK);
      out.push(i % 2 === 0 ? `${tech}.${name}.dev` : `${name}.${tech}.io`);
    }
    return out;
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  prefix = '/',
}: AppCtx): Promise<void> => {
  if (!args.length) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ Please provide a name.\nUsage: \`${prefix}devname <n> [style]\`\n` +
        `Available styles: ${Object.keys(generators).join(', ')}`,
    });
    return;
  }

  const name = args[0]!.toLowerCase().trim();
  const style = args[1]?.toLowerCase();
  const validStyles = Object.keys(generators);

  if (!/^[a-z]{2,20}$/.test(name)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⚠️ **Invalid Name**\nUse 2–20 letters (A–Z) only.',
    });
    return;
  }

  if (style && !validStyles.includes(style)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Invalid Style**\nAvailable: ${validStyles.join(', ')}`,
    });
    return;
  }

  const loadingId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🎨 **Generating usernames...**',
  });

  try {
    let message = '';

    if (style) {
      const names = generators[style]!(name, 6);
      message =
        `🎯 **${style.toUpperCase()} Usernames**\n\n` +
        names.map((n, i) => `${i + 1}. \`${n}\``).join('\n');
    } else {
      const blocks = validStyles.map((s) => {
        const names = generators[s]!(name, 4);
        return `**${s.toUpperCase()}**\n${names.map((n) => `• \`${n}\``).join('\n')}`;
      });
      message = `🎨 **Username Suggestions**\n\n${blocks.join('\n\n')}`;
    }

    if (loadingId) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: loadingId as string,
        message,
      });
    }
  } catch (err) {
    const error = err as { message?: string };
    if (loadingId) {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: loadingId as string,
        message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
      });
    }
  }
};
