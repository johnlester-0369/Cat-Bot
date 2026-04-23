/**
 * /help — Command List and Detail Viewer
 *
 * Two modes, resolved from the first argument:
 *   /help                → paginated command list, page 1
 *   /help <page>         → paginated command list, specific page
 *   /help <command_name> → full detail card for a single command
 *
 * ── Output Format ─────────────────────────────────────────────────────────────
 * List view:
 *
 *   ▸ Commands
 *   ──────────────
 *    1. !ping — Ping the bot
 *    2. !help — Shows all available commands
 *   ──────────────
 *   Page 1 of 3 · 25 commands
 *   !help <page> · !help <command>
 *
 * Detail view:
 *
 *   ▸ ping
 *   ──────────────
 *   Desc    : Ping the bot
 *   Category: Info
 *   Aliases : p, pong
 *   Usage   : !ping
 *   ──────────────
 *   Role    : 0 (All users)
 *   Cooldown: 5s
 *   Version : 1.0.0
 *   Author  : John Lester
 *
 * Pagination: 20 commands per page, alphabetically sorted by canonical config.name.
 * Aliases collapse — getCanonicalMods() deduplicates by config.name before rendering.
 *
 * Context shape: onCommand receives { chat, args, commands, prefix, native } because
 * command.dispatcher.ts spreads commandCtx before appending args and state.
 */

import type { CommandMap, AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'help',
  aliases: ['start'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Shows all available commands or detailed info for a specific command',
  category: 'Info',
  usage: '[command | page]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'query',
      description: 'Command name for details or page number',
      required: false,
    },
  ],
};

/** Commands shown per page — kept small enough to fit a typical mobile chat window. */
const COMMANDS_PER_PAGE = 10;

/**
 * Human-readable label for each numeric role level.
 * Mirroring Role values explicitly rather than a dynamic lookup keeps this file
 * independent from any future Role additions that might not have display labels yet.
 */
const ROLE_LABEL: Record<number, string> = {
  [Role.ANYONE]: '0 (All users)',
  [Role.THREAD_ADMIN]: '1 (Group administrators)',
  [Role.BOT_ADMIN]: '2 (Bot admin)',
  [Role.PREMIUM]: '3 (Premium)',
  [Role.SYSTEM_ADMIN]: '4 (System admin)',
};

/** Thin horizontal rule used as a section separator. */
const HR = '─────────────────';

/**
 * Returns a deduplicated, alphabetically-sorted array of command modules.
 *
 * The live CommandMap stores one key per command name AND one key per alias,
 * all pointing to the same module reference. Without deduplication, aliased
 * commands would appear multiple times in the help list — once per registered key.
 * Deduplication is keyed on config.name (the canonical display name) so the
 * rendered list matches what /help <name> and the command dispatcher recognise.
 */
function getCanonicalMods(
  commands: CommandMap,
  disabledNames: Set<string> = new Set(),
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];

  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    // Skip alias duplicates and bot-admin-disabled commands — a disabled command is
    // non-existent from the user's perspective; never surface it in the help list
    if (!name || seen.has(name) || disabledNames.has(name)) continue;
    seen.add(name);
    result.push(mod);
  }

  // Stable alphabetical order so the list is predictable across restarts regardless
  // of dynamic import resolution order (which is non-deterministic in Node ESM).
  result.sort((a, b) => {
    const an = String(
      (a['config'] as Record<string, unknown> | undefined)?.['name'] ?? '',
    );
    const bn = String(
      (b['config'] as Record<string, unknown> | undefined)?.['name'] ?? '',
    );
    return an.localeCompare(bn);
  });

  return result;
}

/**
 * Crops a description string to max characters, appending "…" when truncated.
 * Prevents long descriptions from wrapping across multiple chat lines in the list view.
 */
function crop(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

const BUTTON_ID = { prev: 'prev', next: 'next' } as const;

// Exported button map routes standard interactive clicks back to this module
export const button = {
  [BUTTON_ID.prev]: {
    label: '◀ Prev',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => {
      ctx.args = [String(ctx.session.context['page'] || 1)];
      await onCommand(ctx);
    },
  },
  [BUTTON_ID.next]: {
    label: 'Next ▶',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => {
      ctx.args = [String(ctx.session.context['page'] || 2)];
      await onCommand(ctx);
    },
  },
};

export const onCommand = async ({
  chat,
  args,
  commands,
  prefix = '',
  native,
  event,
  button,
}: AppCtx): Promise<void> => {
  // noUncheckedIndexedAccess — args[0] is string | undefined
  const arg = args[0]?.toLowerCase() ?? '';

  // Resolve which commands are disabled for this session once, up-front, so both
  // the detail view and the paginated list use the same consistent snapshot.
  // Fail-open: show all commands when session identity is absent or DB is unreachable —
  // identical fail-open contract to getDisabledNamesForSession in message.handler.ts.
  const sessionUserId = native.userId ?? '';
  const sessionId = native.sessionId ?? '';
  let disabledNames = new Set<string>();
  if (sessionUserId && sessionId) {
    try {
      const rows = await findSessionCommands(
        sessionUserId,
        native.platform,
        sessionId,
      );
      disabledNames = new Set(
        rows
          .filter(
            (r: { isEnable: boolean; commandName: string }) => !r.isEnable,
          )
          .map((r: { commandName: string }) => r.commandName),
      );
    } catch {
      // DB unreachable — fail-open, show all commands rather than breaking /help
    }
  }

  // Hide commands unsupported on this platform so they do not leak in help lists
  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (name && !isPlatformAllowed(mod, native.platform)) {
      disabledNames.add(name);
    }
  }

  // Resolve the set of role levels the invoking user can access.
  // A simple numeric ceiling is wrong because PREMIUM (3) grants ANYONE + THREAD_ADMIN + PREMIUM
  // but intentionally excludes BOT_ADMIN (2) — the levels are non-monotone. A Set is accurate
  // and automatically forward-safe when new roles are appended to Role in the future.
  const senderID = (event['senderID'] ?? event['userID'] ?? '') as string;
  // WHY: Extract threadID to check thread-level privileges, resolving TS2304 compiler error
  const threadID = (event['threadID'] ?? '') as string;
  const accessibleRoles = new Set<number>([Role.ANYONE]);
  if (sessionUserId && sessionId && senderID) {
    try {
      // System admins hold global authority — checked first to avoid unnecessary
      // isBotAdmin/isBotPremium DB calls. SYSTEM_ADMIN membership unlocks every
      // privilege tier so /help surfaces all commands, including those gated at
      // Role.SYSTEM_ADMIN which no sub-admin role can otherwise reach.
      // Mirrors the short-circuit pattern in enforcePermission middleware.
      const isSysAdmin = await isSystemAdmin(senderID);
      if (isSysAdmin) {
        accessibleRoles.add(Role.THREAD_ADMIN);
        accessibleRoles.add(Role.BOT_ADMIN);
        accessibleRoles.add(Role.PREMIUM);
        accessibleRoles.add(Role.SYSTEM_ADMIN);
      } else {
        const isAdmin = await isBotAdmin(
          sessionUserId,
          native.platform,
          sessionId,
          senderID,
        );
        if (isAdmin) {
          // Bot admins can run every command — include all known role levels.
          accessibleRoles.add(Role.THREAD_ADMIN);
          accessibleRoles.add(Role.BOT_ADMIN);
          accessibleRoles.add(Role.PREMIUM);
        } else {
          const isPremium = await isBotPremium(
            sessionUserId,
            native.platform,
            sessionId,
            senderID,
          );
          if (isPremium) {
            // Premium users see ANYONE + THREAD_ADMIN + PREMIUM commands.
            // BOT_ADMIN is intentionally absent — premium is a sub-admin tier.
            accessibleRoles.add(Role.THREAD_ADMIN);
            accessibleRoles.add(Role.PREMIUM);
          } else if (threadID) {
            const isThreadAdm = await isThreadAdmin(threadID, senderID);
            if (isThreadAdm) accessibleRoles.add(Role.THREAD_ADMIN);
          }
        }
      }
    } catch {
      // Fail-open: DB outage defaults to ANYONE — /help degrades gracefully.
    }
  }

  // Commands whose role level is absent from accessibleRoles are hidden — they appear
  // identical to bot-admin-disabled commands so privilege probing via /help <name>
  // returns the same "not found" message regardless of why the command is inaccessible.
  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    const cmdRole = Number(
      (cfg?.['role'] as number | undefined) ?? Role.ANYONE,
    );
    if (name && !accessibleRoles.has(cmdRole)) {
      disabledNames.add(name);
    }
  }

  // ── Detail view ─────────────────────────────────────────────────────────────
  // A non-numeric, non-empty arg is treated as a command name rather than a page
  // number. isNaN('') → true, so the empty string falls through to the list path.
  if (arg && isNaN(Number(arg))) {
    // Look up by the arg directly — CommandMap already includes alias keys so both
    // /help ping and /help p (if 'p' is an alias) resolve to the same module.
    const mod = commands.get(arg);
    if (!mod) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `Command "${arg}" was not found.\nType ${prefix}help to see all available commands.`,
      });
      return;
    }

    // Treat disabled commands as non-existent — return the same "not found" message
    // to avoid leaking the existence of commands the bot admin has suppressed.
    const modCfg = mod['config'] as Record<string, unknown> | undefined;
    const canonicalName =
      (modCfg?.['name'] as string | undefined)?.toLowerCase() ?? arg;
    if (disabledNames.has(canonicalName)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `Command "${arg}" was not found.\nType ${prefix}help to see all available commands.`,
      });
      return;
    }

    const cfg = mod['config'] as Record<string, unknown>;
    const name = String(cfg['name'] ?? arg);
    const aliasArr = Array.isArray(cfg['aliases'])
      ? (cfg['aliases'] as string[])
      : [];
    const aliases = aliasArr.length > 0 ? aliasArr.join(', ') : 'None';
    const version = String(cfg['version'] ?? 'N/A');
    const category = String(cfg['category'] ?? 'Uncategorized');
    const roleNum = Number(cfg['role'] ?? Role.ANYONE);
    const role = ROLE_LABEL[roleNum] ?? String(roleNum);
    const cooldown =
      cfg['cooldown'] != null ? `${String(cfg['cooldown'])}s` : 'None';
    const description = String(cfg['description'] ?? 'No description.');
    const author = String(cfg['author'] ?? 'Unknown');
    // Build usage display lines — string[] allows multiple usage patterns per command so
    // authors with 2–3 distinct signatures can document all paths without a full guide[].
    // Single-item arrays collapse to the same one-liner format as a plain string so existing
    // commands migrating from string → string[] produce identical output at zero cost.
    const rawUsage = cfg['usage'];
    const usageLines: string[] = (() => {
      if (Array.isArray(rawUsage)) {
        const items = rawUsage as string[];
        if (items.length <= 1) {
          const u = String(items[0] ?? '');
          return [`**Usage:** \`${prefix}${name}${u ? ` ${u}` : ''}\``];
        }
        return [`**Usage:**`, ...items.map((u) => `  • \`${prefix}${name}${u ? ` ${String(u)}` : ''}\``)];
      }
      const u = String(rawUsage ?? '');
      return [`**Usage:** \`${prefix}${name}${u ? ` ${u}` : ''}\``];
    })();
    // Render guide entries only when the module author explicitly provides them —
    // guide is additive detail for commands that document complex sub-command trees.
    const guideArr = Array.isArray(cfg['guide']) ? (cfg['guide'] as string[]) : [];
    const guideLines: string[] =
      guideArr.length > 0 ? [`**Guide:**`, ...guideArr.map((g) => `  • ${g}`)] : [];

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `『 **${name}** 』`,
        `» ${description}`,
        ``,
        HR,
        `**Category:** ${category}`,
        `**Aliases:** ${aliases}`,
        ...usageLines,
        ...guideLines,
        HR,
        `**Role:** ${role}`,
        `**Cooldown:** ${cooldown}`,
        `**Version:** ${version}`,
        `**Author:** ${author}`,
      ].join('\n'),
    });
    return;
  }

  // ── Paginated list view ──────────────────────────────────────────────────────
  const allMods = getCanonicalMods(commands, disabledNames);
  const totalCmds = allMods.length;
  const totalPages = Math.max(1, Math.ceil(totalCmds / COMMANDS_PER_PAGE));

  // arg is '' (no argument) or a numeric string; clamp to [1, totalPages] so
  // /help 0 and /help 999 both resolve gracefully without an error message.
  const page = arg ? Math.min(Math.max(1, parseInt(arg, 10)), totalPages) : 1;

  const startIdx = (page - 1) * COMMANDS_PER_PAGE;
  const pageMods = allMods.slice(startIdx, startIdx + COMMANDS_PER_PAGE);

  // Build numbered command rows — global index (not page-local) so the number
  // is stable when the user navigates between pages and compares entries.
  const cmdLines = pageMods.map((mod, i) => {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = String(cfg?.['name'] ?? '');
    const desc = String(cfg?.['description'] ?? '');
    const num = startIdx + i + 1;
    // Right-align numbers up to 99 so entries line up cleanly in monospace chat
    const padNum = String(num).padStart(2, ' ');
    // Crop long descriptions so a single entry never wraps across two chat lines
    return `${padNum}. \`${prefix}${name}\` — ${crop(desc, 38)}`;
  });

  // Setup dynamic interactive buttons for navigating backward and forward through command lists
  const activeButtons: string[] = [];
  if (page > 1) {
    const prevId = button.generateID({ id: BUTTON_ID.prev });
    button.createContext({ id: prevId, context: { page: page - 1 } });
    activeButtons.push(prevId);
  }
  if (page < totalPages) {
    const nextId = button.generateID({ id: BUTTON_ID.next });
    button.createContext({ id: nextId, context: { page: page + 1 } });
    activeButtons.push(nextId);
  }

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: [
      `Commands`,
      HR,
      ...cmdLines,
      HR,
      `Page (${page}/${totalPages})`,
      `Currently the bot has ${totalCmds} command(s) `,
      `» ${prefix}help <page> to navigate pages`,
      `» ${prefix}help <command> to view command details`,
    ].join('\n'),
    ...(hasNativeButtons(native.platform) &&
    native.platform != Platforms.FacebookPage &&
    activeButtons.length > 0
      ? { button: activeButtons }
      : {}),
  };

  // Automatically update the original message instance if invoked from a button action
  if (event['type'] === 'button_action') {
    await chat.editMessage({
      ...payload,
      message_id_to_edit: event['messageID'] as string,
    });
  } else {
    await chat.replyMessage(payload);
  }
};
