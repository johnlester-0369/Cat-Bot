/**
 * Telegram Platform Listener — Factory
 *
 * Creates an EventEmitter-based platform listener that wraps Telegraf.
 * Delegates each lifecycle step to a focused module:
 *   - types.ts          → TelegramConfig, TelegramEmitter, PLATFORM_ID
 *   - slash-commands.ts → Command menu registration across broadcast scopes
 *   - handlers.ts       → All Telegraf update handler registrations
 *
 * Lifecycle (per Telegraf docs — all handlers must be registered BEFORE launch):
 *   1. Construct Telegraf instance
 *   2. Register or clear slash command menu across all broadcast scopes
 *   3. Attach all update handlers (they emit typed events on the returned emitter)
 *   4. Call bot.launch() with allowedUpdates — polling starts here
 */
import { EventEmitter } from 'events';
import { Telegraf } from 'telegraf';
import { createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import type { TelegramConfig, TelegramEmitter } from './types.js';
import { registerSlashMenu } from './slash-commands.js';
import { attachHandlers } from './handlers.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { isAuthError } from '@/engine/lib/retry.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import { env } from '@/engine/config/env.config.js';

// Slash sync: register a re-registration callback so the dashboard toggle can update the live '/' menu
import {
  registerSlashSync,
  unregisterSlashSync,
} from '@/engine/modules/prefix/slash-sync.lib.js';
// Read enabled/disabled state from DB when the dashboard triggers a sync
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
// Webhook handler registry — shared with server/app.ts so the existing Express HTTP server
// can route Telegram Bot API POST requests to the correct Telegraf session handler.
import {
  registerTelegramWebhookHandler,
  unregisterTelegramWebhookHandler,
} from '@/engine/modules/session/telegram-webhook.registry.js';
import { generateTelegramSecretToken } from '@/server/utils/hash.util.js';

/**
 * Creates a Telegram platform listener.
 * Register .on() handlers on the returned emitter BEFORE calling start().
 */
export function createTelegramListener(
  config: TelegramConfig,
): TelegramEmitter {
  const emitter = new EventEmitter() as TelegramEmitter;
  let activeBot: Telegraf | null = null;

  // Retained across start() calls so the slash-sync closure always references the current commands Map
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.Telegram],
    sessionId: config.sessionId,
  });

  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    // Store for the slash-sync closure — captured by reference so restarts see the new commands Map
    activeCommands = commands;

    sessionLogger.info('[telegram] Starting Listener...');

    activeBot = new Telegraf(config.botToken);

    // Validate bot token with an explicit getMe() call before registering handlers or launching.
    // bot.launch() calls getMe internally as a fire-and-forget Promise — if it times out or returns
    // 401, the rejection escapes to app.ts's process.once('unhandledRejection') which crashes every
    // session. Calling getMe() here surfaces the error inside start() where withRetry can classify it:
    //   - ETIMEDOUT / network → rethrow → withRetry retries with backoff
    //   - HTTP 401 Unauthorized → rethrow → shouldRetry returns false → session goes offline
    try {
      await activeBot.telegram.getMe();
    } catch (err) {
      activeBot = null; // Release the instance — a fresh one is created on the next attempt
      throw err; // Propagate so startSessionWithRetry's shouldRetry can classify it
    }

    // Step 1: Register or clear slash command menu across all broadcast scopes
    await registerSlashMenu(
      activeBot,
      commands,
      config.prefix,
      config.userId,
      config.sessionId,
      sessionLogger,
    );

    // Step 2: Attach all update handlers — must happen before bot.launch()
    attachHandlers(
      activeBot,
      emitter,
      config.prefix,
      config.userId,
      config.sessionId,
    );

    // Catch errors thrown inside any Telegraf middleware or handler.
    // Without this, handler rejections surface as unhandled promise rejections
    // which crash Node ≥15 and take down every other platform session.
    // _ctx typed as unknown because callback_query / message contexts have different shapes.
    activeBot.catch((err: unknown, _ctx: unknown) => {
      sessionLogger.error('[telegram] Handler error (session continues)', {
        error: err,
      });
    });

    // Step 3: Start receiving updates.
    // Webhook mode: set TELEGRAM_WEBHOOK_DOMAIN to your public HTTPS domain (e.g. "example.com").
    //   → bot.createWebhook() registers the URL with Telegram's Bot API and returns a
    //     RequestListener. The handler is stored in the registry so server/app.ts can route
    //     incoming POST requests to this session without an extra port or server.
    // Polling mode (default): no public domain required; works in local development.
    const rawWebhookDomain = env.TELEGRAM_WEBHOOK_DOMAIN;
    if (rawWebhookDomain) {
      // Strip any protocol prefix — Telegraf builds the full HTTPS URL from the bare domain.
      const domain = rawWebhookDomain.replace(/^https?:\/\//, '');
      const webhookPath = `/api/v1/telegram-webhook/${config.userId}/${config.sessionId}`;
      const handler = await activeBot.createWebhook({
        domain,
        path: webhookPath,
        // Derived from ENCRYPTION_KEY + userId + sessionId — unique per session, no extra env var.
        // Telegraf validates X-Telegram-Bot-Api-Secret-Token on every POST; non-Telegram senders rejected.
        secret_token: generateTelegramSecretToken(
          config.userId,
          config.sessionId,
        ),
        // message_reaction is opt-in since Bot API 7.0 — Telegram only delivers these
        // updates to a webhook endpoint when allowed_updates is explicitly set via
        // setWebhook(). createWebhook() spreads extra keys directly into setWebhook(),
        // so omitting this list means reactions silently never arrive in webhook mode.
        // Must mirror the allowedUpdates array in the polling launch() call below.
        allowed_updates: [
          'message',
          'message_reaction',
          'message_reaction_count',
          'callback_query',
        ],
      });
      registerTelegramWebhookHandler(
        `${config.userId}:${config.sessionId}`,
        handler,
      );
      sessionLogger.info(
        `[telegram] Webhook mode active — Telegram will POST to https://${domain}${webhookPath}`,
      );
    } else {
      // Long-polling fallback — all handlers must be registered before launch() per Telegraf docs.
      activeBot
        .launch({
          // message_reaction and message_reaction_count are opt-in since Bot API 7.0 —
          // Telegram does not deliver them unless explicitly requested here.
          allowedUpdates: [
            'message',
            'message_reaction',
            'message_reaction_count',
            'callback_query',
          ],
        })
        .catch((err: unknown) => {
          // "Bot is stopped!" is emitted during graceful stop() — not an error condition.
          // All other errors are logged per-session so one failing account never brings down others.
          if (err instanceof Error && err.message === 'Bot is stopped!') return;
          if (isAuthError(err)) {
            sessionLogger.error(
              '[telegram] Session offline — bot token revoked during active polling',
              { error: err },
            );
            // Alert UI proactively if token dies mid-session
            void sessionManager.markInactive(
              `${config.userId}:${Platforms.Telegram}:${config.sessionId}`,
            );
          } else {
            sessionLogger.warn(
              '[telegram] Polling interrupted (non-fatal; will recover if network restores)',
              { error: err },
            );
          }
        });
      sessionLogger.info('[telegram] Bot running (long-polling).');
    }

    sessionLogger.info('[telegram] Listener active');

    // Register the slash sync callback AFTER launch succeeds.
    // The closure captures activeBot and activeCommands by variable reference so restarts automatically
    // bind to the new Telegraf instance without needing to re-register.
    const smKey = `${config.userId}:${Platforms.Telegram}:${config.sessionId}`;
    registerSlashSync(smKey, async () => {
      if (!activeBot || !activeCommands) return;
      const livePrefix = prefixManager.getPrefix(
        config.userId,
        Platforms.Telegram,
        config.sessionId,
      );
      // Fetch current enabled/disabled state from DB to filter the command menu accurately
      const rows = await findSessionCommands(
        config.userId,
        Platforms.Telegram,
        config.sessionId,
      );
      // WHY: Explicitly cast as Set<string> because database exports fall back to `any`, causing Set<unknown> inference
      const disabledNames = new Set<string>(
        rows
          .filter(
            (r: { isEnable: boolean; commandName: string }) => !r.isEnable,
          )
          .map((r: { commandName: string }) => r.commandName),
      );
      await registerSlashMenu(
        activeBot,
        activeCommands,
        livePrefix,
        config.userId,
        config.sessionId,
        sessionLogger,
        disabledNames,
        true, // forceRegister — dashboard toggle changes enabled-set, not the config hash
      );
    });
  };

  emitter.stop = async (signal?: string): Promise<void> => {
    sessionLogger.info('[telegram] Stopping Listener...');
    // Clean up before stopping the bot so stale callbacks don't fire on a dead session
    unregisterSlashSync(
      `${config.userId}:${Platforms.Telegram}:${config.sessionId}`,
    );
    // Remove the webhook handler entry so server/app.ts returns 404 for this dead session
    unregisterTelegramWebhookHandler(`${config.userId}:${config.sessionId}`);
    activeCommands = null;
    if (activeBot) {
      try {
        activeBot.stop(signal || 'Restarting');
      } catch {
        // Suppress "Bot is not running!" — start() may have set activeBot but aborted before launch()
      }
      activeBot = null;
    }
  };

  return emitter;
}
