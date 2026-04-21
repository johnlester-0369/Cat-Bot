import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { runAgent } from '@/engine/agent/agent.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'ai',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'System',
  description:
    'Interact with the AI assistant. It can chat and execute commands on your behalf.',
  category: 'AI Chat',
  usage: '<prompt>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'prompt',
      description: 'Your prompt',
      required: false,
    },
  ],
};

/**
 * Handles explicit command invocation via prefix (e.g., `/ai I want some memes`).
 */
export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const prompt = ctx.args.join(' ').trim();
  if (!prompt) {
    await ctx.chat.replyMessage({
      style: MessageStyle.TEXT,
      message: 'Please provide a prompt. Example: `/ai send a meme`',
    });
    return;
  }

  // Resolve bot nickname and sender display name to inject into the agent's system prompt.
  // Both are passed as explicit params so runAgent owns context injection at the correct layer
  // (system prompt) rather than polluting the user message with prefix strings.
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const nickname =
    ctx.native.userId && ctx.native.sessionId
      ? await getBotNickname(
          ctx.native.userId as string,
          ctx.native.platform,
          ctx.native.sessionId as string,
        )
      : null;
  const userName = senderID ? await ctx.user.getName(senderID) : null;

  try {
    const response = await runAgent(prompt, ctx, nickname, userName);
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: response,
    });
  } catch (err) {
    await ctx.chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `AI Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};

/**
 * Passive middleware listener. Checks every incoming message.
 * If it matches conversational keywords ("Hey bot ..."), triggers the agent transparently.
 * WHY: Enables natural conversational flow without requiring users to prefix commands.
 */
export const onChat = async (ctx: AppCtx): Promise<void> => {
  const message = ((ctx.event['message'] as string | undefined) || '').trim();
  if (!message) return;

  // Resolve the configured nickname once — used both in the trigger regex and agent prompt.
  // Fetched here rather than at module load time because the nickname can change at runtime
  // via the dashboard without restarting the process.
  const nickname =
    ctx.native.userId && ctx.native.sessionId
      ? await getBotNickname(
          ctx.native.userId as string,
          ctx.native.platform,
          ctx.native.sessionId as string,
        )
      : null;
  // Resolve sender name for the agent system prompt — fetched outside the match block so
  // it is available for the full handler scope without redundant async calls per match.
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const userName = senderID ? await ctx.user.getName(senderID) : null;

  const targetName = nickname || 'Cat-Bot';

  // Simple inclusion check to trigger the conversational AI anywhere in the message
  if (message.toLowerCase().includes(targetName.toLowerCase())) {
    const prompt = message; // Pass the entire message as the prompt

    try {
      const response = await runAgent(prompt, ctx, nickname, userName);
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: response,
      });
    } catch (err) {
      // Intentionally suppressed from end-user to prevent spam on passive conversational failures
      ctx.logger.error('[ai.ts] onChat agent execution failed', { error: err });
    }
  }
};
