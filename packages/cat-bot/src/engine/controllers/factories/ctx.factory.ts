/**
 * BaseCtx Factory — single source of truth for the unified command execution context.
 *
 * Previously, message.handler.ts, event.handler.ts, and button.dispatcher.ts each
 * duplicated a ~35-line block to assemble api / event / commands / thread / chat /
 * bot / user / logger / db into a BaseCtx.  Any new BaseCtx field required three
 * identical, error-prone edits scattered across the handler layer.
 *
 * This factory owns that construction once.  All three entry-point handlers call it
 * at the top of their function body and receive a fully initialised ctx.
 */

import type { BaseCtx, CommandMap, NativeContext } from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/engine/adapters/models/context.model.js';
import { createLogger } from '@/engine/lib/logger.lib.js';
import { PLATFORM_TO_ID } from '@/engine/constants/platform.constants.js';
import { getUserName, getAllUserSessionData } from '@/engine/repos/users.repo.js';
import { getThreadName } from '@/engine/repos/threads.repo.js';
import {
  createCollectionManager,
  createThreadCollectionManager,
} from '@/engine/lib/db-collection.lib.js';

/**
 * Builds a complete BaseCtx from raw handler inputs.
 *
 * All three entry-point handlers (handleMessage, handleEvent, handleButtonAction)
 * call this once per incoming event.  The returned ctx is then passed through
 * middleware chains and dispatchers unchanged.
 *
 * @param prefix - Present only on message events.  With exactOptionalPropertyTypes: true
 *                 the key is conditionally spread — never written as `prefix: undefined`.
 */
export function buildBaseCtx(
  api: UnifiedApi,
  event: Record<string, unknown>,
  commands: CommandMap,
  native: NativeContext,
  prefix?: string,
): BaseCtx {
  const thread = createThreadContext(api, event);
  // Generic chat context — handlers that need a command-aware variant (button callbacks,
  // slash-command dispatch) override ctx.chat after calling this factory.
  const chat = createChatContext(api, event);
  const bot = createBotContext(api);
  const user = createUserContext(api);
  const logger = createLogger({
    userId: native.userId ?? '',
    platformId: (PLATFORM_TO_ID as Record<string, number>)[native.platform] ?? native.platform,
    sessionId: native.sessionId ?? '',
  });

  return {
    api,
    event,
    commands,
    // Only spread prefix when explicitly provided — exactOptionalPropertyTypes disallows
    // `prefix: undefined` on BaseCtx, so we omit the key entirely when absent.
    ...(prefix !== undefined ? { prefix } : {}),
    thread,
    chat,
    bot,
    user,
    native,
    logger,
    db: {
      users: {
        getName: getUserName,
        // Pre-scoped to (sessionOwnerUserId, platform, sessionId) — command modules pass only botUserId
        collection: createCollectionManager(native.userId ?? '', native.platform, native.sessionId ?? ''),
        // Returns all bot_users_session records for the current bot identity
        getAll: () => getAllUserSessionData(native.userId ?? '', native.platform, native.sessionId ?? ''),
      },
      threads: {
        getName: getThreadName,
        // Pre-scoped to session coords — per-thread features call collection(botThreadId) directly
        collection: createThreadCollectionManager(native.userId ?? '', native.platform, native.sessionId ?? ''),
      },
    },
  };
}