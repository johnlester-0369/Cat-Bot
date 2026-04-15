import type { AppCtx } from '@/engine/types/controller.types.js';

/**
 * Standard interface for dynamically loaded agent tools.
 * Mirrors the structure of command modules.
 */
export interface AgentTool {
  config: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  /**
   * The tool execution handler.
   * `args` is the parsed JSON arguments object from the AI.
   * `ctx` is the unified app context.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any, ctx: AppCtx) => Promise<string> | string;
}

/**
 * Extracts the common session identity triple from any AppCtx.
 *
 * Every agent tool needs senderID / threadID / sessionUserId for ban, role,
 * and disabled-command checks. Centralising extraction here prevents the same
 * field-path strings from being copy-pasted into each tool's run() body.
 */
export function resolveAgentContext(ctx: AppCtx) {
  return {
    senderID: (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string,
    threadID: (ctx.event['threadID'] ?? '') as string,
    sessionUserId: ctx.native.userId ?? '',
    sessionId: ctx.native.sessionId ?? '',
    platform: ctx.native.platform,
  };
}