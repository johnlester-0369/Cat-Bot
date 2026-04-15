import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Groq from 'groq-sdk';
import type { CommandMap, AppCtx } from '@/engine/types/controller.types.js';
import { inspectCommandConstraints } from '@/engine/agent/agent-command-guard.lib.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
// Role-aware help tool dependencies — same imports as help.ts so filtering logic is identical
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { Role } from '@/engine/constants/role.constants.js';

// ============================================================================
// PROMPT TEMPLATE
// ============================================================================
// Load synchronously at module evaluation time so it is instantly available
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Read prompt from relocated agent directory (works symmetrically from src/ and dist/ contexts)
const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(path.join(__dirname, '../../../agent/system_prompt.md'), 'utf-8');

// ============================================================================
// CONTEXT HELPER
// ============================================================================

/**
 * Extracts the common session identity triple from any AppCtx.
 *
 * Every agent tool needs senderID / threadID / sessionUserId for ban, role,
 * and disabled-command checks. Centralising extraction here prevents the same
 * field-path strings from being copy-pasted into each tool's run() body —
 * a single change to AppCtx shape only needs to be fixed in one place.
 */
function resolveAgentContext(ctx: AppCtx) {
  return {
    senderID: (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string,
    threadID: (ctx.event['threadID'] ?? '') as string,
    sessionUserId: ctx.native.userId ?? '',
    sessionId: ctx.native.sessionId ?? '',
    platform: ctx.native.platform,
  };
}

// ============================================================================
// HELP TOOL UTILITIES
// Mirrors help.ts exactly — kept in sync so the agent sees the same filtered,
// paginated command list as the /help command. Any changes to help.ts pagination
// or filtering must be reflected here.
// ============================================================================

/** Commands per page — matches /help command for consistent UX. */
const COMMANDS_PER_PAGE = 10;

/** Horizontal rule used as section separator in detail view. */
const HR = '─────────────────';

/**
 * Human-readable label for each numeric Role level.
 * Explicitly listed (not a dynamic lookup) so the agent output is predictable
 * even if new Role values are appended before they have display labels.
 */
const ROLE_LABEL: Record<number, string> = {
  [Role.ANYONE]: '0 (All users)',
  [Role.THREAD_ADMIN]: '1 (Group administrators)',
  [Role.BOT_ADMIN]: '2 (Bot admin)',
};

/**
 * Returns deduplicated, alphabetically-sorted canonical command modules,
 * excluding any name in the disabledNames set.
 *
 * The CommandMap stores one key per command name AND one key per alias —
 * all pointing to the same module reference. Without deduplication an aliased
 * command would appear once per registered key. Mirrored from help.ts.
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
    const an = String((a['config'] as Record<string, unknown> | undefined)?.['name'] ?? '');
    const bn = String((b['config'] as Record<string, unknown> | undefined)?.['name'] ?? '');
    return an.localeCompare(bn);
  });

  return result;
}

/**
 * Crops a string to max characters, appending "…" when truncated.
 * Keeps tool output concise so the LLM receives scannable lists rather than
 * wall-of-text descriptions. Mirrored from help.ts.
 */
function crop(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

// ============================================================================
// TOOLS
// ============================================================================

/**
 * Dynamically builds tools bound to the current AppCtx.
 *
 * resolveAgentContext() is called inside each tool's run() so identity fields
 * are always derived from the live request rather than a stale snapshot
 * captured at tool-definition time (which would be wrong for concurrent sessions).
 */
const getTools = (ctx: AppCtx) => [
  {
    name: 'help',
    description:
      'Get the paginated, role-filtered command list or full details for a specific command — ' +
      "exactly what the '/help' command shows this user. Use this before 'execute_command' to " +
      'verify the command exists and the invoking user is permitted to run it.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "A command name for the detail view (e.g. 'admin'), a page number (e.g. '2') for a specific list page, " +
            'or omit/empty string for page 1.',
        },
      },
      required: [],
    },

    run: async ({ query }: { query?: string }) => {
      const { senderID, threadID, sessionUserId, sessionId, platform } =
        resolveAgentContext(ctx);
      const arg = (query ?? '').toLowerCase().trim();

      // ── Build the disabled-command set — same three filters as /help ──────────
      // Order matters: 1) bot-admin toggle, 2) platform support, 3) role ceiling.
      // disabledNames is additive — once a name is in it, nothing removes it.
      let disabledNames = new Set<string>();

      // 1. Commands toggled off by the bot admin via the dashboard
      if (sessionUserId && sessionId) {
        try {
          const rows = await findSessionCommands(sessionUserId, platform, sessionId);
          disabledNames = new Set(
            rows
              .filter((r: { isEnable: boolean; commandName: string }) => !r.isEnable)
              .map((r: { commandName: string }) => r.commandName),
          );
        } catch {
          // Fail-open — show all commands when DB is unreachable rather than
          // returning an empty or misleading list to the LLM.
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
      //    Mirrors the role-resolution block in help.ts exactly so the agent and
      //    the /help command always agree on what is visible — prevents the LLM
      //    from discovering BOT_ADMIN commands on behalf of a regular user.
      let userMaxRole: number = Role.ANYONE;
      if (sessionUserId && sessionId && senderID) {
        try {
          const isAdmin = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
          if (isAdmin) {
            userMaxRole = Role.BOT_ADMIN;
          } else if (threadID) {
            const isThreadAdm = await isThreadAdmin(threadID, senderID);
            if (isThreadAdm) userMaxRole = Role.THREAD_ADMIN;
          }
        } catch {
          // Fail-open — DB error defaults to ANYONE; the agent degrades to showing
          // only public commands rather than breaking the help response entirely.
        }
      }

      for (const mod of ctx.commands.values()) {
        const cfg = mod['config'] as Record<string, unknown> | undefined;
        const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
        const cmdRole = Number((cfg?.['role'] as number | undefined) ?? Role.ANYONE);
        if (name && cmdRole > userMaxRole) {
          disabledNames.add(name);
        }
      }

      // ── Detail view — non-numeric, non-empty arg treated as command name ───────
      // isNaN('') → true so empty string falls through to the paginated list path.
      if (arg && isNaN(Number(arg))) {
        const mod = ctx.commands.get(arg);
        if (!mod) return `Command "${arg}" not found.`;

        const modCfg = mod['config'] as Record<string, unknown> | undefined;
        const canonicalName =
          (modCfg?.['name'] as string | undefined)?.toLowerCase() ?? arg;

        // Treat disabled commands as non-existent — same contract as /help to prevent
        // the agent from leaking suppressed command names to the user via AI responses.
        if (disabledNames.has(canonicalName)) return `Command "${arg}" not found.`;

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
        // WHY: Inject current session's prefix to match the UX of the standard /help command
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

      // Clamp page to [1, totalPages] — same as /help so "page 0" and "page 999"
      // resolve gracefully without an error response that confuses the LLM.
      const page = arg
        ? Math.min(Math.max(1, parseInt(arg, 10)), totalPages)
        : 1;

      const startIdx = (page - 1) * COMMANDS_PER_PAGE;
      const pageMods = allMods.slice(startIdx, startIdx + COMMANDS_PER_PAGE);

      // Global numbering (not page-local) matches /help output — the LLM can quote
      // "command 14 is X" consistently without recalculating across pages.
      const cmdLines = pageMods.map((mod, i) => {
        const cfg = mod['config'] as Record<string, unknown> | undefined;
        const name = String(cfg?.['name'] ?? '');
        const desc = String(cfg?.['description'] ?? '');
        const num = startIdx + i + 1;
        // WHY: Format with prefix and backticks so the LLM identifies the exact command string
        return `${String(num).padStart(2, ' ')}. \`${ctx.prefix || '/'}${name}\` — ${crop(desc, 60)}`;
      });

      return [
        `Commands (Page ${page}/${totalPages}) — ${totalCmds} total`,
        HR,
        ...cmdLines,
        HR,
        `Pass a page number as query to navigate. Pass a command name for full details.`,
      ].join('\n');
    },
    },

    {
      name: 'test_command',
      description:
        'Execute a command silently to see its output without sending it to the user. ' +
        'Use this to fetch information (like balances, user data) so you can read it ' +
        'and formulate a conversational reply. Do NOT use this for random generators (like memes).',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: "The command name without prefix (e.g. `balance`)",
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments to pass to the command',
          },
        },
        required: ['command', 'args'],
      },

      // WHY: Intercepts the command's API calls so the LLM can read the output
      // without disrupting the user's chat thread. Cooldowns are NOT consumed.
      run: async ({ command, args }: { command: string; args: string[] }) => {
        const { senderID, threadID, sessionUserId, sessionId, platform } =
          resolveAgentContext(ctx);

        const mod = ctx.commands.get(command.toLowerCase());
        if (!mod || typeof mod['onCommand'] !== 'function') {
          return `Error: Command '${command}' not found.`;
        }

        try {
          const simulatedMessage =
            `${ctx.prefix || '/'}${command} ${(args || []).join(' ')}`.trim();
          const simulatedEvent = {
            ...ctx.event,
            message: simulatedMessage,
            body: simulatedMessage,
          };

          // Check constraints but do NOT consume the cooldown window during previews
          const guard = await inspectCommandConstraints(
            mod, command.toLowerCase(), senderID, threadID, sessionUserId, platform, sessionId, false
          );
          if (!guard.allowed) return `Command '${command}' cannot be tested: ${guard.reason}`;

          const intercepted: unknown[] = [];
          const sideEffects = new Set([
            'replyMessage', 'sendMessage', 'editMessage', 'reactToMessage', 'unsendMessage',
            'setNickname', 'setGroupName', 'setGroupImage', 'removeGroupImage',
            'addUserToGroup', 'removeUserFromGroup', 'setGroupReaction'
          ]);

          // Proxy the API to intercept message sends/edits/replies safely
          const mockApi = new Proxy(ctx.api, {
            get(target, prop, receiver) {
              if (typeof prop === 'string' && sideEffects.has(prop)) {
                return async (...mArgs: unknown[]) => {
                  intercepted.push({ method: prop, args: mArgs });
                  return 'mock-msg-id';
                };
              }
              const value = Reflect.get(target, prop, receiver);
              return typeof value === 'function' ? value.bind(target) : value;
            }
          });

          const commandCtx: OnCommandCtx = {
            ...ctx,
            api: mockApi,
            event: simulatedEvent,
            parsed: { name: command, args: args || [] },
            prefix: ctx.prefix || '/',
            mod,
            options: OptionsMap.empty(),
          };

          await dispatchCommand(ctx.commands, commandCtx.parsed!, commandCtx, mockApi, threadID, commandCtx.prefix);

          if (intercepted.length === 0) {
            return `Command '${command}' executed silently but produced no output.`;
          }

          // Handle circular references gracefully if commands dump streams or raw buffers
          const cache = new Set();
          return JSON.stringify(intercepted, (key, value) => {
            if (typeof value === 'object' && value !== null) {
              if (cache.has(value)) return '[Circular]';
              cache.add(value);
            }
            return typeof value === 'bigint' ? value.toString() : value;
          }, 2);
        } catch (err) {
          return `Error testing command: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    {
      name: 'execute_command',
      description:
      'Execute a specific bot command on behalf of the user. ' +
      'Only use commands that appear in the help tool output for this user.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: "The command name without prefix (e.g. `admin`)",
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments to pass to the command',
        },
      },
      required: ['command', 'args'],
    },

    // WHY: Enables the AI to seamlessly act as a proxy user, reusing existing
    // command business logic without duplicating permission or cooldown enforcement.
    run: async ({ command, args }: { command: string; args: string[] }) => {
      // Centralised extraction — one call replaces five repeated field-path lookups
      const { senderID, threadID, sessionUserId, sessionId, platform } =
        resolveAgentContext(ctx);

      const mod = ctx.commands.get(command.toLowerCase());
      if (!mod || typeof mod['onCommand'] !== 'function') {
        return `Error: Command '${command}' not found.`;
      }

      try {
        // Simulate a real user typing the command so middleware guards receive a
        // plausible message body — required by parsing utilities that inspect body.
        const simulatedMessage =
          `${ctx.prefix || '/'}${command} ${(args || []).join(' ')}`.trim();
        const simulatedEvent = {
          ...ctx.event,
          message: simulatedMessage,
          body: simulatedMessage,
        };

        const commandCtx: OnCommandCtx = {
          ...ctx,
          event: simulatedEvent,
          parsed: { name: command, args: args || [] },
          prefix: ctx.prefix || '/',
          mod,
          options: OptionsMap.empty(),
        };

        // AI-readable guard — inspects the same ban → permission → cooldown chain as
        // the onCommand middleware but returns a structured result the LLM can quote
        // verbatim rather than receiving only an opaque void/silent-drop signal.
        const guard = await inspectCommandConstraints(
          mod,
          command.toLowerCase(),
          senderID,
          threadID,
          sessionUserId,
          platform,
          sessionId,
        );

        if (!guard.allowed) {
          // LLM relays this naturally: "I can't run that — it's on cooldown for 4s."
          return `Command '${command}' cannot be executed: ${guard.reason}`;
        }

        // Dispatch directly — guard already consumed the cooldown window;
        // running the full middleware chain again would double-count it.
        await dispatchCommand(
          ctx.commands,
          commandCtx.parsed!,
          commandCtx,
          ctx.api,
          threadID,
          commandCtx.prefix,
        );

        return `Command '${command}' executed successfully via simulated user input.`;
      } catch (err) {
        return `Error executing command: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];

// =========================
// 🚀 AGENT LOOP ENGINE
// =========================
/**
 * Runs the ReAct-style agent loop, resolving tool calls recursively until a
 * final text answer is produced or the turn limit is reached.
 */

export async function runAgent(userInput: string, ctx: AppCtx, nickname?: string | null, userName?: string | null): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error(
      'GROQ_API_KEY environment variable is not set. AI capabilities are disabled.',
    );
  }

  const groq = new Groq({ apiKey: groqApiKey });
  const tools = getTools(ctx);

  const groqTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  // Inject dynamic context variables into the structured system prompt template.
  // This gives the LLM explicit awareness of its identity, the current user's role,
  // and the command prefix — the role prevents the agent from surfacing restricted
  // commands conversationally to users who cannot invoke them.
  const { senderID, threadID, sessionUserId, sessionId, platform } = resolveAgentContext(ctx);
  // Mirror the bot-admin > thread-admin > anyone hierarchy from help.ts (lines 221–239)
  // and the help tool's role-resolution block (agent.ts lines 185–207) so the agent's
  // identity context always agrees with what /help and execute_command actually permit.
  let userRoleLabel = 'Regular User';
  if (senderID && sessionUserId && sessionId) {
    try {
      const isAdmin = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
      if (isAdmin) {
        userRoleLabel = 'Bot Administrator';
      } else if (threadID) {
        const isThreadAdm = await isThreadAdmin(threadID, senderID);
        if (isThreadAdm) userRoleLabel = 'Thread Administrator';
      }
    } catch {
      // Fail-open — a temporary DB outage defaults to Regular User so the agent
      // continues with reduced context rather than failing the entire request.
    }
  }
  const systemContent = SYSTEM_PROMPT_TEMPLATE
    .replace('{{BOT_NAME}}', nickname || 'Cat-Bot')
    .replace('{{USER_NAME}}', userName || 'User')
    .replace('{{COMMAND_PREFIX}}', ctx.prefix || '/')
    .replace('{{USER_ROLE}}', userRoleLabel);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'system',
      content: systemContent,
    },
    { role: 'user', content: userInput },
  ];

  let turns = 10; // Safety limit — prevents runaway tool-call loops on misbehaving LLM responses

  while (turns-- > 0) {
    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages,
      tools: groqTools,
      tool_choice: 'auto',
    });

    const message = response.choices[0]?.message;
    if (!message) break;

    messages.push(message);

    // ✅ FINAL ANSWER — no tool calls pending
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || 'Task finished.';
    }

    // =========================
    // 🔧 TOOL EXECUTION
    // =========================
    for (const toolCall of message.tool_calls) {
      const tool = tools.find((t) => t.name === toolCall.function.name);

      if (!tool) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: Tool '${toolCall.function.name}' not found.`,
        });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await tool.run(args as any);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: String(result),
        });
      } catch (err) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Tool execution error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  return 'I had to stop processing because the task required too many steps.';
}
