import type { AppCtx, CommandMap } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { Role } from '@/engine/constants/role.constants.js';

// ============================================================================
// HELP TOOL UTILITIES
// Mirrors help.ts exactly — kept in sync so the agent sees the same filtered,
// paginated command list as the /help command.
// ============================================================================

const COMMANDS_PER_PAGE = 10;
const HR = '─────────────────';

const ROLE_LABEL: Record<number, string> = {
  [Role.ANYONE]: '0 (All users)',
  [Role.THREAD_ADMIN]: '1 (Group administrators)',
  [Role.BOT_ADMIN]: '2 (Bot admin)',
};

/**
 * Returns deduplicated, alphabetically-sorted canonical command modules,
 * excluding any name in the disabledNames set.
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
    if (!name || seen.has(name) || disabledNames.has(name)) continue;
    seen.add(name);
    result.push(mod);
  }

  // Stable alphabetical order regardless of dynamic import resolution order
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
 * Crops a string to max characters, appending "…" when truncated.
 */
function crop(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'help',
  description:
    'Get the paginated command list or full command details. ' +
    'Accepts a command name or a page number. ' +
    "Use before 'test_command' to view command arguments and verify access.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "An exact command name (e.g. 'balance', 'ping'), a page number (e.g. '2'), or omit/empty for page 1.",
      },
    },
    required: [],
  },
};

export const run = async (
  { query }: { query?: string },
  ctx: AppCtx,
): Promise<string> => {
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);
  const arg = (query ?? '').toLowerCase().trim();

  // ── Build the disabled-command set — same three filters as /help ──────────
  let disabledNames = new Set<string>();

  // 1. Commands toggled off by the bot admin via the dashboard
  if (sessionUserId && sessionId) {
    try {
      const rows = await findSessionCommands(
        sessionUserId,
        platform,
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
      // Fail-open — show all commands when DB is unreachable
    }
  }

  // 2. Commands the current platform transport does not support
  for (const mod of ctx.commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (name && !isPlatformAllowed(mod, platform)) {
      disabledNames.add(name);
    }
  }

  // 3. Resolve the user's effective privilege ceiling then hide commands above it.
  let userMaxRole: number = Role.ANYONE;
  if (sessionUserId && sessionId && senderID) {
    try {
      const isAdmin = await isBotAdmin(
        sessionUserId,
        platform,
        sessionId,
        senderID,
      );
      if (isAdmin) {
        userMaxRole = Role.BOT_ADMIN;
      } else if (threadID) {
        const isThreadAdm = await isThreadAdmin(threadID, senderID);
        if (isThreadAdm) userMaxRole = Role.THREAD_ADMIN;
      }
    } catch {
      // Fail-open
    }
  }

  for (const mod of ctx.commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    const cmdRole = Number(
      (cfg?.['role'] as number | undefined) ?? Role.ANYONE,
    );
    if (name && cmdRole > userMaxRole) {
      disabledNames.add(name);
    }
  }

  // ── Detail view — non-numeric, non-empty arg treated as command name ───────
  if (arg && isNaN(Number(arg))) {
    const mod = ctx.commands.get(arg);
    if (!mod) {
      return `No commands found matching "${arg}".`;
    }

    const modCfg = mod['config'] as Record<string, unknown> | undefined;
    const canonicalName =
      (modCfg?.['name'] as string | undefined)?.toLowerCase() ?? arg;

    if (disabledNames.has(canonicalName)) {
      return `No accessible commands found matching "${arg}".`;
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
    const roleLabel = ROLE_LABEL[roleNum] ?? String(roleNum);
    const cooldown =
      cfg['cooldown'] != null ? `${String(cfg['cooldown'])}s` : 'None';
    const description = String(cfg['description'] ?? 'No description.');
    const usage = String(cfg['usage'] ?? '');
    const author = String(cfg['author'] ?? 'Unknown');
    const usageLine = `${ctx.prefix || '/'}${name}${usage ? ` ${usage}` : ''}`;

    return [
      `『 ${name} 』`,
      `» ${description}`,
      ``,
      HR,
      `Category : ${category}`,
      `Aliases  : ${aliases}`,
      `Usage    : ${usageLine}`,
      HR,
      `Role     : ${roleLabel}`,
      `Cooldown : ${cooldown}`,
      `Version  : ${version}`,
      `Author   : ${author}`,
    ].join('\n');
  }

  // ── Paginated list view ──────────────────────────────────────────────────
  const allMods = getCanonicalMods(ctx.commands, disabledNames);
  const totalCmds = allMods.length;
  const totalPages = Math.max(1, Math.ceil(totalCmds / COMMANDS_PER_PAGE));

  const page = arg ? Math.min(Math.max(1, parseInt(arg, 10)), totalPages) : 1;
  const startIdx = (page - 1) * COMMANDS_PER_PAGE;
  const pageMods = allMods.slice(startIdx, startIdx + COMMANDS_PER_PAGE);

  const cmdLines = pageMods.map((mod, i) => {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = String(cfg?.['name'] ?? '');
    const desc = String(cfg?.['description'] ?? '');
    const num = startIdx + i + 1;
    return `${String(num).padStart(2, ' ')}. \`${ctx.prefix || '/'}${name}\` — ${crop(desc, 60)}`;
  });

  return [
    `Commands (Page ${page}/${totalPages}) — ${totalCmds} total`,
    HR,
    ...cmdLines,
    HR,
    `Pass a page number as query to navigate. Pass a command name for full details.`,
  ].join('\n');
};
