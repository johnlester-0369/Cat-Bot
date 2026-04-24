import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Groq from 'groq-sdk';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '@/engine/agent/agent.util.js';
import type { AgentTool } from '@/engine/agent/agent.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';

// ============================================================================
// PROMPT TEMPLATE
// ============================================================================
// Load synchronously at module evaluation time so it is instantly available
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Read prompt from relocated agent directory (works symmetrically from src/ and dist/ contexts)
const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../../../agent/system_prompt.md'),
  'utf-8',
);

// ============================================================================
// MODULAR TOOL LOADER
// ============================================================================

let cachedTools: AgentTool[] | null = null;

/**
 * Dynamically loads agent tools from the tools/ directory.
 * Mirrors the architecture of the command dispatcher for modularity.
 * Caches the resolved tools for the lifecycle of the process.
 */
export async function loadAgentTools(): Promise<AgentTool[]> {
  if (cachedTools) return cachedTools;

  const tools: AgentTool[] = [];
  const dir = path.join(__dirname, 'tools');

  if (!fs.existsSync(dir)) {
    cachedTools = [];
    return cachedTools;
  }

  // Allow loading .ts files during local dev via tsx, whilst ignoring compiled type definitions
  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  for (const file of files) {
    try {
      const mod = (await import(
        pathToFileURL(path.join(dir, file)).href
      )) as AgentTool;

      // Ensure the loaded module implements the AgentTool interface properly
      if (mod.config && typeof mod.run === 'function') {
        tools.push(mod);
      }
    } catch (err) {
      console.error(`[Agent] Failed to load tool ${file}`, err);
    }
  }

  cachedTools = tools;
  return cachedTools;
}

// =========================
// 🚀 AGENT LOOP ENGINE
// =========================
/**
 * Runs the ReAct-style agent loop, resolving tool calls recursively until a
 * final text answer is produced or the turn limit is reached.
 */
export async function runAgent(
  userInput: string,
  ctx: AppCtx,
  nickname?: string | null,
  userName?: string | null,
): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error(
      'GROQ_API_KEY environment variable is not set. AI capabilities are disabled.',
    );
  }

  const groq = new Groq({ apiKey: groqApiKey });

  // Dynamically fetch modular tools instead of generating hard-coded ones
  const tools = await loadAgentTools();

  const groqTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.config.name,
      description: t.config.description,
      parameters: t.config.parameters,
    },
  }));

  // Inject dynamic context variables into the structured system prompt template.
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);
  let userRoleLabel = 'Regular User';
  if (senderID && sessionUserId && sessionId) {
    try {
      const isAdmin = await isBotAdmin(
        sessionUserId,
        platform,
        sessionId,
        senderID,
      );
      if (isAdmin) {
        userRoleLabel = 'Bot Administrator';
      } else if (threadID) {
        const isThreadAdm = await isThreadAdmin(threadID, senderID);
        if (isThreadAdm) userRoleLabel = 'Thread Administrator';
      }
    } catch {
      // Fail-open — a temporary DB outage defaults to Regular User
    }
  }

  const systemContent = SYSTEM_PROMPT_TEMPLATE.replace(
    '{{BOT_NAME}}',
    nickname || 'Cat-Bot',
  )
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

  let turns = 20; // Safety limit — prevents runaway tool-call loops

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
      const tool = tools.find((t) => t.config.name === toolCall.function.name);

      if (!tool) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: Tool '${toolCall.function.name}' not found.`,
        });
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      try {
        // Execute dynamic tool passing the requested args and the application context
        const result = await tool.run(args, ctx);
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
