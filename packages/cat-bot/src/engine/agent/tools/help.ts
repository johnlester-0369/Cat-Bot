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
// SIMILARITY SEARCH — reduces agent round-trip loops for command discovery
// ============================================================================

/**
 * Dice's Coefficient bigram similarity — produces a 0.0–1.0 score.
 * Inlined rather than imported from command-suggest.util to keep agent tools self-contained
 * and to avoid a cross-package import boundary from the tools/ leaf directory.
 */
function diceSim(a: string, b: string): number {
  const f = a.replace(/\s+/g, '');
  const s = b.replace(/\s+/g, '');
  if (f === s) return 1;
  if (f.length < 2 || s.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < f.length - 1; i++) {
    const bg = f.substring(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.substring(i, i + 2);
    const cnt = bigrams.get(bg) ?? 0;
    if (cnt > 0) {
      bigrams.set(bg, cnt - 1);
      hits++;
    }
  }
  return (2 * hits) / (f.length + s.length - 2);
}

interface SearchResult {
  name: string;
  description: string;
  score: number;
}

/**
 * Multi-field similarity search across command name, aliases, description, and category.
 * Returns up to 8 ranked results so the agent can discover relevant commands from partial
 * or keyword queries (e.g. "image", "economy", "music") without requiring exact name matches.
 * Avoids the repeated help → not found → guess → help loop that adds unnecessary turns.
 */
function searchCommands(
  query: string,
  commands: CommandMap,
  disabledNames: Set<string>,
): SearchResult[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const mod of commands.values()) {
    const cfg = mod['config'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (!name || seen.has(name) || disabledNames.has(name)) continue;
    seen.add(name);

    const desc = ((cfg?.['description'] as string | undefined) ?? '').toLowerCase();
    const category = ((cfg?.['category'] as string | undefined) ?? '').toLowerCase();
    const aliases = (
      Array.isArray(cfg?.['aliases']) ? (cfg!['aliases'] as string[]) : []
    ).map((a) => String(a).toLowerCase());

    // Composite score: best of (name bigram + contain bonus, alias bigram + contain bonus).
    // Contains bonus rewards exact substring hits that bigrams undercount for short queries
    // (e.g. querying "ai" produces 0 bigrams but a perfect contain hit on name "ai").
    const nameSim = diceSim(q, name);
    const nameContains = name.includes(q) ? 0.4 : 0;
    const aliasBest = aliases.reduce(
      (best, a) => Math.max(best, diceSim(q, a), a.includes(q) ? 0.4 : 0),
      0,
    );
    const descBonus = desc.split(/\s+/).some((w) => w.startsWith(q)) ? 0.25 : 0;
    const catBonus = category.includes(q) ? 0.15 : 0;

    const score = Math.max(nameSim + nameContains, aliasBest) + descBonus + catBonus;
    if (score >= 0.15) {
      results.push({ name, description: String(cfg?.['description'] ?? ''), score });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 8);
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'help',
  description:
    'Get the paginated command list, full command details, or similarity-search results for keywords. ' +
    'Accepts a command name (exact or partial), descriptive keywords (e.g. "image", "economy", "music"), ' +
    'or a page number. Partial names and keywords trigger similarity search returning up to 8 ' +
    "ranked matches. Use before 'test_command' to discover and verify available commands.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "A command name (exact or partial), descriptive keywords (e.g. 'image generation', 'balance', 'fun'), " +
          "a page number (e.g. '2'), or omit/empty for page 1. " +
          'Partial names and keywords trigger similarity search — prefer this over guessing exact names.',
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
      // Fall back to similarity search so the agent receives ranked candidates instead of
      // a dead-end "not found" response that forces another guessing round-trip.
      const results = searchCommands(arg, ctx.commands, disabledNames);
      if (results.length === 0) return `No commands found matching "${arg}". Try a broader keyword.`;
      return `Closest matches for "${arg}":\n` +
        results.map((r) => `• \`${ctx.prefix || '/'}${r.name}\` — ${crop(r.description, 60)}`).join('\n');
    }

    const modCfg = mod['config'] as Record<string, unknown> | undefined;
    const canonicalName =
      (modCfg?.['name'] as string | undefined)?.toLowerCase() ?? arg;

    if (disabledNames.has(canonicalName)) {
      // Treat disabled commands as unknown — surface accessible alternatives via search
      // rather than returning a dead-end that causes the agent to loop with more guesses.
      const results = searchCommands(arg, ctx.commands, disabledNames);
      if (results.length === 0) return `No accessible commands found matching "${arg}".`;
      return `Closest matches for "${arg}":\n` +
        results.map((r) => `• \`${ctx.prefix || '/'}${r.name}\` — ${crop(r.description, 60)}`).join('\n');
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
