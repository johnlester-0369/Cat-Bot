import type { UnifiedApi } from '../../../src/adapters/models/api.model.js';
import type {
  ChatContext,
  ThreadContext,
  UserContext,
  BotContext,
} from '../../../src/adapters/models/context.model.js';

/**
 * Standardized Context Map emitted by each platform setup layer.
 * This completely decouples authentication/instantiation logic from the test assertions.
 */
export interface PlatformTestContext {
  platformName: string;
  api: UnifiedApi;
  chatCtx: ChatContext;
  threadCtx: ThreadContext;
  userCtx: UserContext;
  botCtx: BotContext;
  botUserId: string | null;
  targetUserId: string;
  threadId: string;
  messageId: string;
  teardown?: () => void | Promise<void>;
}
