/**
 * /menu — Category-Based Command Browser
 *
 * Alternative to /help. Presents all commands grouped by category.
 *
 * Flow — button platforms (Discord, Telegram):
 *   1. /menu → Category list with one button per category in a dynamic grid
 *   2. [Category button] → Category detail with a ◀️ Back button
 *   3. [Back button] → Returns to category list in-place
 *
 *   Discord grid layout:
 *     Discord allows a maximum of 5 ActionRows (button rows) per message and
 *     5 buttons per row. The chunk size is computed dynamically from the
 *     category count so the grid never exceeds 5 rows regardless of how many
 *     categories the bot has. Formula: Math.ceil(count / 5), clamped to [2, 5].
 *     Up to 25 categories render natively; beyond 25 the grid is capped at 5×5
 *     and excess categories are listed as plain text below the buttons.
 *
 *   Telegram uses the same grid (Telegram has no ActionRow cap).
 *
 * Flow — reply platforms (Facebook Messenger, Facebook Page):
 *   1. /menu → Numbered category list sent once; message ID is registered with
 *      state keyed to that ID.
 *   2. User replies with a number → Category detail is shown, then the state
 *      is re-created under the SAME session ID (same original message key).
 *   3. The user can reply to the SAME original menu message indefinitely —
 *      no new menu message is ever sent after the initial one.
 *
 * Filtering mirrors /help exactly:
 *   • Commands disabled via the dashboard are hidden
 *   • Commands restricted to other platforms are hidden
 *   • Commands whose role level exceeds the invoker's privileges are hidden
 *
 * prefix is always sourced from AppCtx — never hardcoded.
 */

import type { CommandMap, AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'menu',
  aliases: ['commands', 'cmds'] as string[],
  version: '2.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Browse all commands by category.',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Discord layout constants ───────────────────────────────────────────────────

/**
 * Discord API hard limits — do not raise these.
 * https://discord.com/developers/docs/components/reference
 */
const DISCORD_MAX_ROWS = 5;
const DISCORD_MAX_BUTTONS_PER_ROW = 5;
const DISCORD_MAX_BUTTONS = DISCORD_MAX_ROWS * DISCORD_MAX_BUTTONS_PER_ROW; // 25

// ── State keys (reply-nav platforms only) ─────────────────────────────────────

const STATE = {
  awaiting_category: 'awaiting_category',
} as const;

// ── Platform helpers ──────────────────────────────────────────────────────────

function isReplyNavPlatform(platform: string): boolean {
  return (
    platform === Platforms.FacebookMessenger ||
    platform === Platforms.FacebookPage
  );
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function formatCategory(value: string): string {
  const cleaned = String(value ?? 'Uncategorized').trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Uncategorized';
  return cleaned
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function categoryKey(value: string): string {
  return String(value ?? 'Uncategorized').trim().replace(/\s+/g, ' ').toLowerCase();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

/**
 * Computes the button chunk size that keeps the grid within Discord's 5-row
 * limit while keeping a minimum of 2 buttons per row for visual balance.
 *
 * Examples:
 *   4  categories → chunkSize 2 → 2 rows  ✅
 *   10 categories → chunkSize 2 → 5 rows  ✅
 *   11 categories → chunkSize 3 → 4 rows  ✅
 *   20 categories → chunkSize 4 → 5 rows  ✅
 *   25 categories → chunkSize 5 → 5 rows  ✅
 *   26 categories → grid capped at 25, rest shown as text
 */
function discordChunkSize(count: number): number {
  return Math.min(
    DISCORD_MAX_BUTTONS_PER_ROW,
    Math.max(2, Math.ceil(count / DISCORD_MAX_ROWS)),
  );
}

// ── Filtering ─────────────────────────────────────────────────────────────────

async function buildDisabledNames(
  commands: CommandMap,
  native: AppCtx['native'],
  event: Record<string, unknown>,
): Promise<Set<string>> {
  const disabledNames = new Set<string>();
  const sessionUserId = native.userId ?? '';
  const sessionId = native.sessionId ?? '';

  if (sessionUserId && sessionId) {
    try {
      const rows = await findSessionCommands(sessionUserId, native.platform, sessionId);
      for (const r of rows as { isEnable: boolean; commandName: string }[]) {
        if (!r.isEnable) disabledNames.add(r.commandName);
      }
    } catch { /* fail-open */ }
  }

  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (name && !isPlatformAllowed(mod, native.platform)) disabledNames.add(name);
  }

  const senderID = (event['senderID'] ?? event['userID'] ?? '') as string;
  const threadID = (event['threadID'] ?? '') as string;
  const accessibleRoles = new Set<number>([Role.ANYONE]);

  if (sessionUserId && sessionId && senderID) {
    try {
      const isSysAdmin = await isSystemAdmin(senderID);
      if (isSysAdmin) {
        accessibleRoles.add(Role.THREAD_ADMIN);
        accessibleRoles.add(Role.BOT_ADMIN);
        accessibleRoles.add(Role.PREMIUM);
        accessibleRoles.add(Role.SYSTEM_ADMIN);
      } else {
        const isAdmin = await isBotAdmin(sessionUserId, native.platform, sessionId, senderID);
        if (isAdmin) {
          accessibleRoles.add(Role.THREAD_ADMIN);
          accessibleRoles.add(Role.BOT_ADMIN);
          accessibleRoles.add(Role.PREMIUM);
        } else {
          const isPremium = await isBotPremium(sessionUserId, native.platform, sessionId, senderID);
          if (isPremium) {
            accessibleRoles.add(Role.THREAD_ADMIN);
            accessibleRoles.add(Role.PREMIUM);
          } else if (threadID) {
            const isThreadAdm = await isThreadAdmin(threadID, senderID);
            if (isThreadAdm) accessibleRoles.add(Role.THREAD_ADMIN);
          }
        }
      }
    } catch { /* fail-open */ }
  }

  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    const cmdRole = Number((cfg?.['role'] as number | undefined) ?? Role.ANYONE);
    if (name && !accessibleRoles.has(cmdRole)) disabledNames.add(name);
  }

  return disabledNames;
}

function getVisibleMods(
  commands: CommandMap,
  disabledNames: Set<string>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];

  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (!name || seen.has(name) || disabledNames.has(name)) continue;
    seen.add(name);
    result.push(mod);
  }

  result.sort((a, b) => {
    const an = String((a['config'] as Record<string, unknown> | undefined)?.['name'] ?? '');
    const bn = String((b['config'] as Record<string, unknown> | undefined)?.['name'] ?? '');
    return an.localeCompare(bn);
  });

  return result;
}

function groupByCategory(
  mods: Array<Record<string, unknown>>,
): Array<[string, Array<Record<string, unknown>>]> {
  const map = new Map<string, { label: string; mods: Array<Record<string, unknown>> }>();

  for (const mod of mods) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const rawCategory = String(cfg?.['category'] ?? 'Uncategorized');
    const key = categoryKey(rawCategory);
    const label = formatCategory(rawCategory);
    const entry = map.get(key);
    if (!entry) map.set(key, { label, mods: [mod] });
    else entry.mods.push(mod);
  }

  return [...map.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ label, mods }) => [label, mods]);
}

// ── Category detail builder (shared) ─────────────────────────────────────────

function buildCategoryLines(
  catMods: Array<Record<string, unknown>>,
  targetCategory: string,
  prefix: string,
): string[] {
  const lines: string[] = [`**${targetCategory.toUpperCase()} COMMAND CENTER**`, ``];

  for (const mod of catMods) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = String(cfg?.['name'] ?? '');
    const desc = String(cfg?.['description'] ?? '');
    lines.push(`▫️ ${prefix}${name}`);
    lines.push(`  ↳ ${desc}`);
    lines.push(``);
  }

  lines.push(`💡 ${prefix}help <command> for details`);
  return lines;
}

// ── Button Platforms: Category List ──────────────────────────────────────────

async function renderCategoryList(ctx: AppCtx): Promise<void> {
  const { chat, commands, native, event, button, prefix = '' } = ctx;

  const disabledNames = await buildDisabledNames(commands, native, event);
  const visibleMods = getVisibleMods(commands, disabledNames);
  const categories = groupByCategory(visibleMods);

  const flatButtonIds: string[] = [];
  // Categories that fit inside the Discord 5×5 grid get buttons.
  const buttonableCategories = categories.slice(0, DISCORD_MAX_BUTTONS);
  // Overflow categories (>25) get plain-text labels below the grid.
  const overflowCategories = categories.slice(DISCORD_MAX_BUTTONS);

  for (const [cat] of buttonableCategories) {
    const catId = button.generateID({ id: BUTTON_ID.cat, public: true });
    button.createContext({ id: catId, context: { category: cat } });
    button.update({ id: catId, label: cat, style: ButtonStyle.PRIMARY });
    flatButtonIds.push(catId);
  }

  // Telegram: fixed 3-column grid per design spec.
  // Discord: dynamic chunk size so the grid never exceeds 5 ActionRows.
  const chunkSize =
    native.platform === Platforms.Telegram
      ? 3
      : discordChunkSize(flatButtonIds.length);
  const buttonGrid: string[][] = chunk(flatButtonIds, chunkSize);

  const messageLines = [
    `▫️ **Command Menu**`,
    ``,
    `Select a category below`,
  ];

  if (overflowCategories.length > 0) {
    messageLines.push(
      ``,
      `_Additional categories (use \`${prefix}help\`):_`,
      ...overflowCategories.map(([cat], i) => `${buttonableCategories.length + i + 1}. ${cat}`),
    );
  }

  messageLines.push(``, `💡 ${prefix}help <command> for command details`);

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: messageLines.join('\n'),
    ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
  };

  if (event['type'] === 'button_action') {
    await chat.editMessage({ ...payload, message_id_to_edit: event['messageID'] as string });
  } else {
    await chat.replyMessage(payload);
  }
}

// ── Button Platforms: Category Commands ───────────────────────────────────────

async function renderCategoryCommands(ctx: AppCtx, category: string): Promise<void> {
  const { chat, commands, native, event, button, prefix = '' } = ctx;

  const disabledNames = await buildDisabledNames(commands, native, event);
  const visibleMods = getVisibleMods(commands, disabledNames);
  const grouped = groupByCategory(visibleMods);

  const targetCategory = formatCategory(category);
  const catEntry = grouped.find(([cat]) => cat === targetCategory);

  if (!catEntry || catEntry[1].length === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**${targetCategory} COMMAND CENTER**\nNo visible commands in this category.`,
    });
    return;
  }

  const [, catMods] = catEntry;
  const lines = buildCategoryLines(catMods, targetCategory, prefix);

  const backId = button.generateID({ id: BUTTON_ID.back, public: true });

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: lines.join('\n'),
    button: [[backId]],
  };

  if (event['type'] === 'button_action') {
    await chat.editMessage({ ...payload, message_id_to_edit: event['messageID'] as string });
  } else {
    await chat.replyMessage(payload);
  }
}

// ── Reply-Nav Platforms: Numbered Category List (sent ONCE) ──────────────────

/**
 * Sends the numbered category menu once and registers state keyed to its
 * message ID. For unlimited-reply mode the state is re-created under the
 * same session ID after every reply — this function is only ever called
 * from onCommand (i.e., the initial /menu invocation).
 */
async function sendNumberedCategoryList(ctx: AppCtx): Promise<void> {
  const { chat, commands, native, event, state, prefix = '' } = ctx;

  const disabledNames = await buildDisabledNames(commands, native, event);
  const visibleMods = getVisibleMods(commands, disabledNames);
  const categories = groupByCategory(visibleMods);
  const categoryNames = categories.map(([cat]) => cat);

  const lines: string[] = [
    `▫️ **Command Menu**`,
    ``,
    `Reply with a number to choose a category:`,
    ``,
    ...categoryNames.map((cat, i) => `${i + 1}. ${cat}`),
    ``,
    `💡 ${prefix}help <command> for details`,
  ];

  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: lines.join('\n'),
  });

  if (!messageID) return;

  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.awaiting_category,
    context: { categories: categoryNames },
  });
}

// ── Reply-Nav Platforms: Category Commands ────────────────────────────────────

async function sendCategoryCommandsForReplyNav(
  ctx: AppCtx,
  category: string,
): Promise<void> {
  const { chat, commands, native, event, prefix = '' } = ctx;

  const disabledNames = await buildDisabledNames(commands, native, event);
  const visibleMods = getVisibleMods(commands, disabledNames);
  const grouped = groupByCategory(visibleMods);

  const targetCategory = formatCategory(category);
  const catEntry = grouped.find(([cat]) => cat === targetCategory);

  if (!catEntry || catEntry[1].length === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**${targetCategory} COMMAND CENTER**\nNo visible commands in this category.`,
    });
  } else {
    const [, catMods] = catEntry;
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: buildCategoryLines(catMods, targetCategory, prefix).join('\n'),
    });
  }
}

// ── Button definitions ────────────────────────────────────────────────────────

const BUTTON_ID = { cat: 'cat', back: 'back' } as const;

export const button = {
  [BUTTON_ID.cat]: {
    label: 'Category',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx): Promise<void> => {
      const category = ctx.session.context['category'] as string | undefined;
      if (!category) return;
      await renderCategoryCommands(ctx, category);
    },
  },

  [BUTTON_ID.back]: {
    label: '◀️ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx): Promise<void> => {
      await renderCategoryList(ctx);
    },
  },
};

// ── onReply (reply-nav platforms only) ───────────────────────────────────────

export const onReply = {
  /**
   * Fired whenever the user replies to the original numbered menu message.
   *
   * Unlimited-reply mechanism:
   *   1. Show the requested category's commands.
   *   2. Delete the current state entry.
   *   3. Re-create state under the SAME session.id (= same message key).
   *   4. The original menu message is never re-sent — the user replies to it
   *      again and this handler fires again, indefinitely.
   *
   * Invalid input gets an error reply and the state is immediately re-created
   * so the user can try again without needing a new /menu invocation.
   */
  [STATE.awaiting_category]: async (ctx: AppCtx): Promise<void> => {
    const { chat, event, state, session } = ctx;

    const input = String(event['message'] ?? '').trim();
    const categoryNames = (session.context['categories'] as string[] | undefined) ?? [];
    const currentStateId = session.id;
    const currentContext = session.context;

    const num = parseInt(input, 10);

    if (isNaN(num) || num < 1 || num > categoryNames.length) {
      // Show error, but keep state alive so user can retry on the same message.
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Please reply with a number between **1** and **${categoryNames.length}**.`,
      });
      // Re-register state on the same message ID so the next reply is still caught.
      state.delete(currentStateId);
      state.create({
        id: currentStateId,
        state: STATE.awaiting_category,
        context: currentContext,
      });
      return;
    }

    const selectedCategory = categoryNames[num - 1]!;

    // Show the category — do this BEFORE re-registering state so the detail
    // message appears before any potential state-related processing.
    await sendCategoryCommandsForReplyNav(ctx, selectedCategory);

    // Re-register state under the SAME session ID (same original menu message key)
    // so the user can reply to the original message again without a new /menu.
    state.delete(currentStateId);
    state.create({
      id: currentStateId,
      state: STATE.awaiting_category,
      context: currentContext,
    });
  },
};

// ── Command entry point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  try {
    if (isReplyNavPlatform(ctx.native.platform)) {
      await sendNumberedCategoryList(ctx);
    } else {
      await renderCategoryList(ctx);
    }
  } catch (err) {
    const error = err as { message?: string };
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};