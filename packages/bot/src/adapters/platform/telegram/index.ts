/**
 * Telegram Platform — Public API
 *
 * Re-export facade — all external consumers (adapters/platform/index.ts)
 * import from here. Internal implementation lives in focused modules:
 *
 *   types.ts          → TelegramConfig, PLATFORM_ID, TelegramEmitter
 *   listener.ts       → createTelegramListener factory
 *   slash-commands.ts → Command menu registration across broadcast scopes
 *   handlers.ts       → Telegraf update handler registrations
 *   wrapper.ts        → UnifiedApi class shell + createTelegramApi factory
 *   unsupported.ts    → Unsupported operation stubs (addUserToGroup, setGroupReaction)
 *   utils/            → Event normalisation utilities (pure functions)
 *   lib/              → Individual UnifiedApi method implementations
 */
export { createTelegramListener } from './listener.js';
export type { TelegramConfig } from './types.js';
