/**
 * /menu — Category-Based Command Browser
 *
 * Alternative to /help. Presents all commands grouped by category.
 *
 * Flow:
 *   1. /menu → Category list — one button per category, rendered in a 2-column grid
 *   2. [Category button] → Category detail — lists commands in that category
 *   3. [Back button] → Returns to category list in-place
 *
 * Filtering: mirrors /help exactly —
 *   • Commands disabled via the dashboard are hidden
 *   • Commands restricted to other platforms are hidden
 *   • Commands whose role level exceeds the invoker's privileges are hidden
 *
 * Button strategy:
 *   • BUTTON_ID.cat  — one generated ID per category; context stores { category: string }
 *   • BUTTON_ID.back — single generated ID; navigates back to category list
 *
 * Grid layout: category buttons are arranged in rows of 2 (string[][])
 * using the engine's native multi-row button support from ReplyMessageOptions.
 *
 * On platforms without native buttons (FB Messenger), the engine's built-in
 * numbered text-menu fallback is used automatically.
 */

import type { CommandMap, AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'menu',
  aliases: ['commands', 'cmds'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Browse all commands by category.',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

/** Crops a string to max characters, appending ellipsis when truncated. */
function crop(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Converts any category text into a clean Title Case display label. */
function formatCategory(value: string): string {
  const cleaned = String(value ?? 'Uncategorized')
    .trim()
    .replace(/\s+/g, ' ');

  if (!cleaned) return 'Uncategorized';

  return cleaned
    .split(' ')
    .map((word) =>
      word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word,
    )
    .join(' ');
}

/** Normalized key for case-insensitive category grouping. */
function categoryKey(value: string): string {
  return String(value ?? 'Uncategorized')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Chunks a flat array into rows of `size`.
 * Used to build the 2-column button grid from a flat category ID list.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

// ── Filtering — exact mirror of help.ts ───────────────────────────────────────

async function buildDisabledNames(
  commands: CommandMap,
  native: AppCtx['native'],
  event: Record<string, unknown>,
): Promise<Set<string>> {
  const disabledNames = new Set<string>();
  const sessionUserId = native.userId ?? '';
  const sessionId = native.sessionId ?? '';

  // 1 — Dashboard-disabled commands
  if (sessionUserId && sessionId) {
    try {
      const rows = await findSessionCommands(
        sessionUserId,
        native.platform,
        sessionId,
      );
      for (const r of rows as { isEnable: boolean; commandName: string }[]) {
        if (!r.isEnable) disabledNames.add(r.commandName);
      }
    } catch {
      // Fail-open: DB unreachable — show everything
    }
  }

  // 2 — Platform-restricted commands
  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (name && !isPlatformAllowed(mod, native.platform)) {
      disabledNames.add(name);
    }
  }

  // 3 — Role-gated commands
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
    } catch {
      // Fail-open: default to ANYONE access
    }
  }

  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    const cmdRole = Number((cfg?.['role'] as number | undefined) ?? Role.ANYONE);
    if (name && !accessibleRoles.has(cmdRole)) disabledNames.add(name);
  }

  return disabledNames;
}

/** Deduplicated, alphabetically-sorted visible command modules. */
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

/**
 * Groups visible modules by category, case-insensitive.
 * "utility", "Utility", and "UTILITY" all become one group: "Utility".
 */
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
    if (!entry) {
      map.set(key, { label, mods: [mod] });
    } else {
      entry.mods.push(mod);
    }
  }

  return [...map.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ label, mods }) => [label, mods]);
}

// ── View: Category List ───────────────────────────────────────────────────────

async function renderCategoryList(ctx: AppCtx): Promise<void> {
  const { chat, commands, native, event, button, prefix = '' } = ctx;

  const disabledNames = await buildDisabledNames(commands, native, event);
  const visibleMods = getVisibleMods(commands, disabledNames);
  const categories = groupByCategory(visibleMods);

  const useNativeButtons =
    hasNativeButtons(native.platform) &&
    native.platform !== Platforms.FacebookPage;

  const flatButtonIds: string[] = [];
  for (const [cat] of categories) {
    const catId = button.generateID({ id: BUTTON_ID.cat, public: true });
    button.createContext({ id: catId, context: { category: cat } });
    button.update({
      id: catId,
      label: cat,
      style: ButtonStyle.PRIMARY,
    });
    flatButtonIds.push(catId);
  }

  const buttonGrid: string[][] = chunk(flatButtonIds, 2);

  const message = [
    `▫️**Command Menu**`,
    ``,
    useNativeButtons
      ? `Select a category below`
      : `Reply with a number to choose a category`,
    `${prefix}help <command> for command details`,
  ].join('\n');

  const payload = {
    style: MessageStyle.MARKDOWN,
    message,
    ...(useNativeButtons && buttonGrid.length > 0 ? { button: buttonGrid } : {}),
  };

  if (event['type'] === 'button_action') {
    await chat.editMessage({
      ...payload,
      message_id_to_edit: event['messageID'] as string,
    });
  } else {
    await chat.replyMessage(payload);
  }
}

// ── View: Category Detail ─────────────────────────────────────────────────────

async function renderCategoryCommands(
  ctx: AppCtx,
  category: string,
): Promise<void> {
  const { chat, commands, native, event, button, prefix = '' } = ctx;

  const disabledNames = await buildDisabledNames(commands, native, event);
  const visibleMods = getVisibleMods(commands, disabledNames);
  const grouped = groupByCategory(visibleMods);

  const targetCategory = formatCategory(category);
  const catEntry = grouped.find(([cat]) => cat === targetCategory);

  if (!catEntry || catEntry[1].length === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**${targetCategory}**\nNo visible commands in this category.`,
    });
    return;
  }

  const [, catMods] = catEntry;

  const maxNameLen = Math.max(
    ...catMods.map((mod) => {
      const cfg = mod['config'] as Record<string, unknown> | undefined;
      return String(cfg?.['name'] ?? '').length;
    }),
  );

  const cmdLines = catMods.map((mod) => {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = String(cfg?.['name'] ?? '');
    const desc = String(cfg?.['description'] ?? '');
    const cmd = `${prefix}${name}`.padEnd(maxNameLen + prefix.length + 1, ' ');
    return `• \`${cmd}\`  ${crop(desc, 30)}`;
  });

  const useNativeButtons =
    hasNativeButtons(native.platform) &&
    native.platform !== Platforms.FacebookPage;

  const backId = button.generateID({ id: BUTTON_ID.back, public: true });
  const backGrid: string[][] = [[backId]];

  const message = [
    `**${targetCategory}**`,
    ...cmdLines,
    ``,
    `${prefix}help <command> for command details`,
  ].join('\n');

  const payload = {
    style: MessageStyle.MARKDOWN,
    message,
    ...(useNativeButtons ? { button: backGrid } : {}),
  };

  if (event['type'] === 'button_action') {
    await chat.editMessage({
      ...payload,
      message_id_to_edit: event['messageID'] as string,
    });
  } else {
    await chat.replyMessage(payload);
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
    label: '← Back',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx): Promise<void> => {
      await renderCategoryList(ctx);
    },
  },
};

// ── Command entry point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  try {
    await renderCategoryList(ctx);
  } catch (err) {
    const error = err as { message?: string };
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};