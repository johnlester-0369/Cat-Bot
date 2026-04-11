/**
 * Telegram Webhook Handler Registry
 *
 * Zero-dependency singleton Map that bridges the Telegram platform listener
 * (engine layer) with the Express server (server layer) without creating a
 * circular import chain.
 *
 * Architecture mirrors facebook-page-session.lib.ts — the registry sits in
 * server/lib/ and is imported by both sides:
 *   - engine/adapters/platform/telegram/listener.ts  → writes on start()/stop()
 *   - server/app.ts                                  → reads on every POST request
 *
 * Key format: `${userId}:${sessionId}`
 * One handler entry per live Telegram session — restart overwrites the previous entry.
 */

// Typed as any-parameters to avoid forcing callers to import node:http types.
// At runtime the handler is Telegraf's RequestListener (IncomingMessage, ServerResponse)
// which is structurally compatible with Express req/res (both extend the Node.js types).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WebhookHandler = (req: any, res: any) => void;

const registry = new Map<string, WebhookHandler>();

/** Stores the Telegraf RequestListener for a session after bot.createWebhook() resolves. */
export function registerTelegramWebhookHandler(
  key: string,
  handler: WebhookHandler,
): void {
  registry.set(key, handler);
}

/**
 * Returns the live handler for the given key, or undefined when no session is registered.
 * Called on every incoming POST /api/v1/telegram-webhook/:userId/:sessionId request.
 */
export function getTelegramWebhookHandler(
  key: string,
): WebhookHandler | undefined {
  return registry.get(key);
}

/** Removes the handler when the session stops — prevents stale requests reaching a dead session. */
export function unregisterTelegramWebhookHandler(key: string): void {
  registry.delete(key);
}
