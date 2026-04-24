/**
 * /top — Session Leaderboard
 *
 * Displays the top N users within the current bot session ranked by two metrics:
 *
 *   /top money [n]  — richest users by coin balance
 *   /top level [n]  — highest-level users by accumulated EXP
 *
 * Data source: bot_users_session.data JSON blob.
 *   money → data['money']['coins']  (written by /daily via currencies.lib)
 *   xp    → data['xp']['exp']       (written by rankup onChat)
 *
 * Full-scan approach via db.users.getAll() — acceptable for single-process bots
 * at typical session sizes (dozens to low thousands of active users). For
 * deployments with tens of thousands of users, consider a dedicated index.
 *
 * Level formula MUST match rank.ts and rankup.ts (DELTA_NEXT = 5):
 *   level = floor((1 + sqrt(1 + 8 * exp / DELTA_NEXT)) / 2)
 * Diverging DELTA_NEXT between modules would silently mis-order leaderboard entries.
 *
 * Button navigation:
 *   money board → shows "🏆 Top Level" toggle button
 *   level board → shows "💰 Top Money" toggle button
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * EXP-to-level curve constant — MUST equal the value in rank.ts and rankup.ts.
 * Changing this alone would reorder leaderboard entries relative to what /rank
 * displays for individual users, breaking user expectations.
 */
const DELTA_NEXT = 5;

/** Default leaderboard length when no limit argument is provided. */
const DEFAULT_LIMIT = 10;

/**
 * Hard cap prevents excessively long messages that could hit platform character limits
 * (Discord: 2000 chars, Telegram: 4096, Facebook: 2000). Even at 20 entries with
 * average 60-char lines, the total is ~1200 chars — safely within all platform limits.
 */
const MAX_LIMIT = 20;

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Converts raw EXP to a level number. Mirrors rank.ts implementation exactly. */
function expToLevel(exp: number): number {
  if (exp <= 0) return 0;
  return Math.floor((1 + Math.sqrt(1 + (8 * exp) / DELTA_NEXT)) / 2);
}

/**
 * Parses and clamps the user-supplied limit string.
 * Invalid input (NaN, zero, negative) silently falls back to DEFAULT_LIMIT
 * so a typo in the limit arg never throws an error in the message handler.
 */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Returns a medal emoji for the top-3 positions; ordinal number string for the rest. */
function position(i: number): string {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

// ── Command config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'top',
  aliases: ['leaderboard', 'lb'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'View top users by coin balance or EXP level',
  category: 'Economy',
  usage: '<money|level> [limit]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'type',
      description: 'Leaderboard type: "money" or "level"',
      required: false,
    },
    {
      type: OptionType.string,
      name: 'limit',
      description: `Number of entries to show (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT})`,
      required: false,
    },
  ],
};

// ── Button IDs ────────────────────────────────────────────────────────────────

const BUTTON_ID = {
  top_money: 'top_money',
  top_level: 'top_level',
} as const;

// ── Buttons ───────────────────────────────────────────────────────────────────

export const button = {
  // Shown when the level board is active — lets the user flip to the money board
  [BUTTON_ID.top_money]: {
    label: '💰 Top Money',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, db, user, native, button }: AppCtx) => {
      const allSessions = await db.users.getAll();
      const ranked = allSessions
        .map(({ botUserId, data }) => {
          // Coins live in data['money']['coins'] — written by /daily via currencies.lib
          const moneyData = data?.['money'] as
            | Record<string, unknown>
            | undefined;
          const coins =
            moneyData && typeof moneyData['coins'] === 'number'
              ? (moneyData['coins'] as number)
              : 0;
          return { botUserId, coins };
        })
        // Exclude zero-balance users so the leaderboard only shows earners
        .filter((u) => u.coins > 0)
        .sort((a, b) => b.coins - a.coins)
        .slice(0, DEFAULT_LIMIT);

      const lines: string[] = [`💰 **Top ${ranked.length} Richest Users**`];
      for (let i = 0; i < ranked.length; i++) {
        const entry = ranked[i]!; // safe: i is always < ranked.length
        // getUserName is LRU-cached — repeated calls here hit memory, not the DB
        const name = await user.getName(entry.botUserId);
        lines.push(
          `${position(i)} **${name}** — ${entry.coins.toLocaleString()} coins`,
        );
      }
      if (ranked.length === 0) lines.push('No users have earned coins yet.');

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: lines.join('\n'),
        // Offer the level-board toggle so users can compare rankings side-by-side
        ...(hasNativeButtons(native.platform)
          ? { button: [button.generateID({ id: BUTTON_ID.top_level })] }
          : {}),
      });
    },
  },

  // Shown when the money board is active — lets the user flip to the level board
  [BUTTON_ID.top_level]: {
    label: '🏆 Top Level',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, db, user, native, button }: AppCtx) => {
      const allSessions = await db.users.getAll();
      const ranked = allSessions
        .map(({ botUserId, data }) => {
          // EXP lives in data['xp']['exp'] — written by rankup onChat on every message
          const xpData = data?.['xp'] as Record<string, unknown> | undefined;
          const exp =
            xpData && typeof xpData['exp'] === 'number'
              ? (xpData['exp'] as number)
              : 0;
          return { botUserId, exp, level: expToLevel(exp) };
        })
        // Exclude users with zero EXP (never sent a message) from the leaderboard
        .filter((u) => u.exp > 0)
        .sort((a, b) => b.exp - a.exp)
        .slice(0, DEFAULT_LIMIT);

      const lines: string[] = [
        `🏆 **Top ${ranked.length} Highest Level Users**`,
      ];
      for (let i = 0; i < ranked.length; i++) {
        const entry = ranked[i]!; // safe: i is always < ranked.length
        const name = await user.getName(entry.botUserId);
        lines.push(
          `${position(i)} **${name}** — Level ${entry.level} (${entry.exp.toLocaleString()} EXP)`,
        );
      }
      if (ranked.length === 0) lines.push('No users have gained EXP yet.');

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: lines.join('\n'),
        // Offer the money-board toggle to close the leaderboard navigation loop
        ...(hasNativeButtons(native.platform)
          ? { button: [button.generateID({ id: BUTTON_ID.top_money })] }
          : {}),
      });
    },
  },
};

// ── Command handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  db,
  user,
  native,
  prefix = '',
  button,
}: AppCtx): Promise<void> => {
  const sub = args[0]?.toLowerCase();

  // No subcommand → show usage rather than defaulting silently; prevents confusing
  // empty-board responses when the user types /top without knowing the syntax.
  if (!sub) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        '**Usage:**',
        `\`${prefix}top money [limit]\` — top richest users`,
        `\`${prefix}top level [limit]\` — top highest level users`,
        `Limit defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
      ].join('\n'),
    });
    return;
  }

  const limit = parseLimit(args[1]);

  // ── Money leaderboard ─────────────────────────────────────────────────────
  if (sub === 'money') {
    const allSessions = await db.users.getAll();
    const ranked = allSessions
      .map(({ botUserId, data }) => {
        const moneyData = data?.['money'] as
          | Record<string, unknown>
          | undefined;
        const coins =
          moneyData && typeof moneyData['coins'] === 'number'
            ? (moneyData['coins'] as number)
            : 0;
        return { botUserId, coins };
      })
      .filter((u) => u.coins > 0)
      .sort((a, b) => b.coins - a.coins)
      .slice(0, limit);

    const lines: string[] = [`💰 **Top ${ranked.length} Richest Users**`];
    for (let i = 0; i < ranked.length; i++) {
      const entry = ranked[i]!; // safe: i is always < ranked.length
      const name = await user.getName(entry.botUserId);
      lines.push(
        `${position(i)} **${name}** — ${entry.coins.toLocaleString()} coins`,
      );
    }
    if (ranked.length === 0) lines.push('No users have earned coins yet.');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines.join('\n'),
      // Toggle button takes the user directly to the level board without retyping a command
      ...(hasNativeButtons(native.platform)
        ? { button: [button.generateID({ id: BUTTON_ID.top_level })] }
        : {}),
    });
    return;
  }

  // ── Level leaderboard ─────────────────────────────────────────────────────
  // Accept both 'level' and 'rank' as aliases — mirrors /rank command naming convention
  if (sub === 'level' || sub === 'rank') {
    const allSessions = await db.users.getAll();
    const ranked = allSessions
      .map(({ botUserId, data }) => {
        const xpData = data?.['xp'] as Record<string, unknown> | undefined;
        const exp =
          xpData && typeof xpData['exp'] === 'number'
            ? (xpData['exp'] as number)
            : 0;
        return { botUserId, exp, level: expToLevel(exp) };
      })
      .filter((u) => u.exp > 0)
      .sort((a, b) => b.exp - a.exp)
      .slice(0, limit);

    const lines: string[] = [`🏆 **Top ${ranked.length} Highest Level Users**`];
    for (let i = 0; i < ranked.length; i++) {
      const entry = ranked[i]!; // safe: i is always < ranked.length
      const name = await user.getName(entry.botUserId);
      lines.push(
        `${position(i)} **${name}** — Level ${entry.level} (${entry.exp.toLocaleString()} EXP)`,
      );
    }
    if (ranked.length === 0) lines.push('No users have gained EXP yet.');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines.join('\n'),
      // Toggle button takes the user directly to the money board without retyping a command
      ...(hasNativeButtons(native.platform)
        ? { button: [button.generateID({ id: BUTTON_ID.top_money })] }
        : {}),
    });
    return;
  }

  // ── Unknown subcommand fallthrough ────────────────────────────────────────
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `❌ Unknown leaderboard type: \`${sub}\``,
      '',
      '**Usage:**',
      `\`${prefix}top money [limit]\` — top richest users`,
      `\`${prefix}top level [limit]\` — top highest level users`,
    ].join('\n'),
  });
};
