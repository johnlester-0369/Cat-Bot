/**
 * Telegram Platform Listener — Factory
 *
 * Creates an EventEmitter-based platform listener that wraps Telegraf.
 * Delegates each lifecycle step to a focused module:
 *   - types.ts          → TelegramConfig, TelegramEmitter, PLATFORM_ID
 *   - slash-commands.ts → Command menu registration across broadcast scopes
 *   - handlers.ts       → All Telegraf update handler registrations
 *
 * Retry architecture:
 *   emitter.start() owns an exponential-backoff retry loop (up to 10 attempts,
 *   3 s → 120 s). Two guards prevent zombie concurrency:
 *     isLocked   — another transition is actively running
 *     isRetrying — back-off sleep is in progress
 *   Start during retry aborts the loop and boots fresh with latest DB credentials.
 *   Stop/Restart are blocked at the service layer during retry.
 *   markActive fires only after full successful boot; markInactive fires on every
 *   failed attempt to keep the dashboard in sync.
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
import { withRetry, isAuthError } from '@/engine/lib/retry.lib.js';
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
import { botRepo } from '@/server/repos/bot.repo.js';

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

  /**
   * Boots the Telegram transport with an internal exponential-backoff retry loop.
   *
   * Spam protection:
   *   isLocked   — another transition is actively running (concurrent op guard)
   *   isRetrying — back-off sleep in progress (idle retry guard)
   * Both checks are synchronous before any await — no race window.
   */
  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    const smKey = `${config.userId}:${Platforms.Telegram}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;
    if (sessionManager.isRetrying(smKey)) return;

    // Claim retry slot synchronously so a rapid second call sees isRetrying = true.
    const controller = new AbortController();
    const retryToken = sessionManager.markRetrying(smKey, () => controller.abort());

    // Signal the dashboard offline immediately; markActive fires on successful boot only.
    void sessionManager.markInactive(smKey);

    let isFirstAttempt = true;

    try {
      await withRetry(
        async () => {
          if (controller.signal.aborted) throw new Error('Retry aborted');

          // Tear down partial state from the previous failed attempt before retrying.
          if (!isFirstAttempt) {
            try {
              unregisterSlashSync(smKey);
              unregisterTelegramWebhookHandler(`${config.userId}:${config.sessionId}`);
              activeCommands = null;
              if (activeBot) {
                try { activeBot.stop('Restarting'); } catch { /* suppress "not running" */ }
                activeBot = null;
              }
            } catch {
              // Non-fatal — a failed cleanup must not block the next start attempt
            }
          }
          isFirstAttempt = false;

          sessionManager.markLocked(smKey);
          try {
            activeCommands = commands;

            sessionLogger.info('[telegram] Starting Listener...');

            // WHY: Fetching inside the retry loop guarantees every attempt uses the
            // latest credentials — covers credential-update auto-restarts.
            const botDetail = await botRepo.getById(config.userId, config.sessionId);
            const botToken = botDetail
              ? ((botDetail.credentials as any).telegramToken ?? config.botToken)
              : config.botToken;
            const prefix = botDetail
              ? (botDetail.prefix ?? config.prefix)
              : config.prefix;
            activeBot = new Telegraf(botToken);

            // Validate bot token before registering handlers or launching.
            // bot.launch() calls getMe() fire-and-forget — if it fails, the rejection
            // escapes to an unhandledRejection and can crash every platform session.
            // Calling getMe() here lets withRetry classify it: 401 → auth error → no retry.
            try {
              await activeBot.telegram.getMe();
            } catch (err) {
              activeBot = null; // Release — a fresh instance is created on the next attempt
              throw err;
            }

            // Step 1: Register or clear slash command menu across all broadcast scopes
            await registerSlashMenu(
              activeBot,
              commands,
              prefix,
              config.userId,
              config.sessionId,
              sessionLogger,
            );

            // Step 2: Attach all update handlers — must happen before bot.launch()
            attachHandlers(
              activeBot,
              emitter,
              prefix,
              config.userId,
              config.sessionId,
            );

            // Catch errors thrown inside any Telegraf middleware or handler.
            // Without this, handler rejections surface as unhandled promise rejections
            // which crash Node ≥15 and take down every other platform session.
            activeBot.catch((err: unknown, _ctx: unknown) => {
              sessionLogger.error('[telegram] Handler error (session continues)', {
                error: err,
              });
            });

            // Step 3: Start receiving updates.
            const rawWebhookDomain = env.TELEGRAM_WEBHOOK_DOMAIN;
            if (rawWebhookDomain) {
              const domain = rawWebhookDomain.replace(/^https?:\/\//, '');
              const webhookPath = `/api/v1/telegram-webhook/${config.userId}/${config.sessionId}`;
              const handler = await activeBot.createWebhook({
                domain,
                path: webhookPath,
                // Derived from ENCRYPTION_KEY + userId + sessionId — unique per session.
                secret_token: generateTelegramSecretToken(
                  config.userId,
                  config.sessionId,
                ),
                // message_reaction is opt-in since Bot API 7.0 — must mirror allowedUpdates below.
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
              // Long-polling fallback — all handlers must be registered before launch().
              activeBot
                .launch({
                  allowedUpdates: [
                    'message',
                    'message_reaction',
                    'message_reaction_count',
                    'callback_query',
                  ],
                })
                .catch((err: unknown) => {
                  // "Bot is stopped!" is emitted during graceful stop() — not an error condition.
                  if (err instanceof Error && err.message === 'Bot is stopped!')
                    return;
                  if (isAuthError(err)) {
                    sessionLogger.error(
                      '[telegram] Session offline — bot token revoked during active polling',
                      { error: err },
                    );
                    void sessionManager.markInactive(smKey);
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
            registerSlashSync(smKey, async () => {
              if (!activeBot || !activeCommands) return;
              const livePrefix = prefixManager.getPrefix(
                config.userId,
                Platforms.Telegram,
                config.sessionId,
              );
              const rows = await findSessionCommands(
                config.userId,
                Platforms.Telegram,
                config.sessionId,
              );
              // WHY: Explicitly cast as Set<string> because database exports fall back to `any`
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

            // markActive only after full successful boot.
            await sessionManager.markActive(smKey);
          } finally {
            sessionManager.markUnlocked(smKey);
          }
        },
        {
          signal: controller.signal,
          maxAttempts: 10,
          initialDelayMs: 3_000,
          backoffFactor: 2,
          maxDelayMs: 120_000,
          onRetry: (attempt, err) => {
            sessionLogger.warn(
              `[telegram] Start attempt ${attempt}/10 failed — retrying with backoff`,
              { error: err },
            );
            // Keep the dashboard in sync: session remains offline during back-off.
            void sessionManager.markInactive(smKey);
          },
          // Auth errors (HTTP 401 / invalid token) are permanent — stop retrying immediately.
          shouldRetry: (err) => !isAuthError(err),
        },
      ).catch((err: unknown) => {
        if (controller.signal.aborted) return;
        sessionLogger.error(
          `[telegram] Permanent startup failure after 10 attempts — session offline`,
          { error: err },
        );
        void sessionManager.markInactive(smKey);
      });
    } finally {
      sessionManager.markNotRetrying(smKey, retryToken);
    }
  };

  emitter.stop = async (signal?: string): Promise<void> => {
    const smKey = `${config.userId}:${Platforms.Telegram}:${config.sessionId}`;
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[telegram] Stopping Listener...');
      // Clean up before stopping the bot so stale callbacks don't fire on a dead session
      unregisterSlashSync(smKey);
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
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}