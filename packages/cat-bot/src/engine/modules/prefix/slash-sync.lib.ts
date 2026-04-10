/**
 * Slash Command Sync Registry — REST Toggle → Live Platform Bridge
 *
 * Decoupled EventEmitter-style registry that lets the REST controller layer
 * (server/controllers/bot-session-config.controller.ts) trigger slash command
 * re-registration on live Discord/Telegram sessions without importing any
 * platform transport code (Discord.js, Telegraf) or creating circular deps.
 *
 * Contract:
 *   - Discord adapter registers a callback on start(); Discord.js Client and
 *     commands Map are captured in the closure.
 *   - Telegram adapter registers a callback on start(); Telegraf instance and
 *     commands Map are captured in the closure.
 *   - The controller calls triggerSlashSync(key) after every setCommandEnabled().
 *     The registered callback fetches current enabled/disabled state from the DB
 *     and calls the platform's registerSlashCommands / registerSlashMenu with the
 *     filtered list.
 *   - Platforms that do not register (FB Messenger, FB Page) → triggerSlashSync
 *     resolves immediately as a no-op; no error is thrown.
 *   - Callbacks are responsible for checking their own prefix — if prefix !== '/',
 *     they return early without issuing any API calls.
 *
 * Key format: `${userId}:${platform}:${sessionId}`
 * Matches the sessionManager key used throughout adapters/platform/index.ts.
 *
 * Dependency direction: lib/slash-sync.lib.ts → (none)
 * Zero external imports — safe to import from any layer without circular risk.
 */

type SlashSyncFn = () => Promise<void>;

/**
 * Keyed by `userId:platform:sessionId`.
 * At most one sync callback per live session — re-registration on restart
 * simply overwrites the previous entry.
 */
const registry = new Map<string, SlashSyncFn>();

/**
 * Registers a slash sync callback for a session.
 * Called by Discord and Telegram adapter start() after the transport is live.
 */
export function registerSlashSync(key: string, fn: SlashSyncFn): void {
  registry.set(key, fn);
}

/**
 * Removes the slash sync callback for a session.
 * Called by Discord and Telegram adapter stop() to prevent stale callbacks
 * from accumulating across restarts.
 */
export function unregisterSlashSync(key: string): void {
  registry.delete(key);
}

/**
 * Triggers the registered slash sync for the given session key.
 * Resolves immediately (no-op) if no callback is registered — this covers
 * FB Messenger, FB Page, and sessions that are not yet started.
 *
 * The controller calls this fire-and-forget after every setCommandEnabled() so
 * the HTTP response is never delayed by a Discord REST or Telegram Bot API call.
 */
export async function triggerSlashSync(key: string): Promise<void> {
  const fn = registry.get(key);
  if (fn) await fn();
}