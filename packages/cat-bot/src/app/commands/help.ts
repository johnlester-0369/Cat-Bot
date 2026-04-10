/**
 * /help — Command List and Detail Viewer
 *
 * Two modes, resolved from the first argument:
 *   /help                → paginated command list, page 1
 *   /help <page>         → paginated command list, specific page
 *   /help <command_name> → full detail card for a single command
 *
 * Pagination: 20 commands per page, alphabetically sorted by canonical config.name.
 * Aliases collapse — the CommandMap stores multiple keys per aliased module, so
 * getCanonicalMods() deduplicates by config.name before counting or rendering.
 *
 * Context shape: onCommand receives { chat, args, commands, prefix } because
 * command.dispatcher.ts spreads commandCtx (which carries the full BaseCtx including
 * commands and prefix) before appending args and state.
 */

import type { CommandMap, AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
// Disabled-command gate — mirrors message.handler.ts: disabled commands are invisible to users
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/utils/platform-filter.util.js';
import { OptionType } from '@/engine/constants/command-option.constants.js';

export const config = {
  name: 'help',
  aliases: ["start"] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Shows all available commands or detailed info for a specific command',
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
const COMMANDS_PER_PAGE = 20;

/**
 * Human-readable label for each numeric role level.
 * Mirroring Role values explicitly rather than a dynamic lookup keeps this file
 * independent from any future Role additions that might not have display labels yet.
 */
const ROLE_LABEL: Record<number, string> = {
  [Role.ANYONE]: 'Anyone',
  [Role.THREAD_ADMIN]: 'Group Admin',
  [Role.BOT_ADMIN]: 'Bot Admin',
};

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

export const onCommand = async ({
  chat,
  args,
  commands,
  prefix = '', // Optional property fallback
  native,
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
      const rows = await findSessionCommands(sessionUserId, native.platform, sessionId);
      disabledNames = new Set(rows.filter((r: { isEnable: boolean; commandName: string }) => !r.isEnable).map((r: { commandName: string }) => r.commandName));
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

  // ── Detail view ─────────────────────────────────────────────────────────────
  // A non-numeric, non-empty arg is treated as a command name rather than a page
  // number. isNaN('') → true, so the empty string falls through to the list path.
  if (arg && isNaN(Number(arg))) {
    // Look up by the arg directly — CommandMap already includes alias keys so both
    // /help ping and /help p (if 'p' is an alias) resolve to the same module.
    const mod = commands.get(arg);
    if (!mod) {
      await chat.replyMessage({
        message: `❓ No command "${arg}" found. Type ${prefix}help for the command list.`,
      });
      return;
    }

    // Treat disabled commands as non-existent — return the same "not found" message
    // to avoid leaking the existence of commands the bot admin has suppressed.
    const modCfg = mod['config'] as Record<string, unknown> | undefined;
    const canonicalModName = (modCfg?.['name'] as string | undefined)?.toLowerCase() ?? arg;
    if (disabledNames.has(canonicalModName)) {
      await chat.replyMessage({
        message: `❓ No command "${arg}" found. Type ${prefix}help for the command list.`,
      });
      return;
    }

    const cfg = mod['config'] as Record<string, unknown>;
    const name = String(cfg['name'] ?? arg);
    const aliasArr = Array.isArray(cfg['aliases'])
      ? (cfg['aliases'] as string[])
      : [];
    // Display empty string (not "[]") when there are no aliases — cleaner chat output
    const aliases = aliasArr.length > 0 ? aliasArr.join(', ') : '';
    const version = String(cfg['version'] ?? '');
    const category = String(cfg['category'] ?? '');
    // Map numeric role to readable label; fall back to raw string for unknown future values
    const roleNum = Number(cfg['role'] ?? Role.ANYONE);
    const role = ROLE_LABEL[roleNum] ?? String(roleNum);
    const cooldown =
      cfg['cooldown'] != null ? `${String(cfg['cooldown'])}s` : '';
    const description = String(cfg['description'] ?? '');
    const usage = String(cfg['usage'] ?? '');

    await chat.replyMessage({
      message: [
        `Name: ${name}`,
        `Aliases: ${aliases}`,
        `Version: ${version}`,
        `Category: ${category}`,
        `Role: ${role}`,
        `Cooldown: ${cooldown}`,
        ``,
        `Description:`,
        description,
        ``,
        `Usage:`,
        // Omit trailing space when usage is empty so the line stays clean
        `${prefix}${name}${usage ? ` ${usage}` : ''}`,
      ].join('\n'),
    });
    return;
  }

  // ── Paginated list view ──────────────────────────────────────────────────────
  const allMods = getCanonicalMods(commands, disabledNames);
  const totalPages = Math.max(1, Math.ceil(allMods.length / COMMANDS_PER_PAGE));

  // arg is '' (no argument) or a numeric string; clamp to [1, totalPages] so
  // /help 0 and /help 999 both resolve gracefully without an error message.
  const page = arg
    ? Math.min(Math.max(1, parseInt(arg, 10)), totalPages)
    : 1;

  const startIdx = (page - 1) * COMMANDS_PER_PAGE;
  const pageMods = allMods.slice(startIdx, startIdx + COMMANDS_PER_PAGE);

  const lines: string[] = [];
  for (const mod of pageMods) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = String(cfg?.['name'] ?? '');
    const desc = String(cfg?.['description'] ?? '');
    lines.push(`${prefix}${name}`);
    lines.push(`  - ${desc}`);
    // Blank line between entries improves readability in dense chat windows
    lines.push('');
  }

  lines.push(`Page: ${page}/${totalPages}`);
  lines.push(`Type ${prefix}help <command> for more information`);
  lines.push('');
  lines.push(`Type ${prefix}help <page_number> to navigate pages`);

  await chat.replyMessage({ message: lines.join('\n') });
};
