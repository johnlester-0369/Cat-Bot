/**
 * Telegram Platform Listener — Factory
 *
 * Creates an EventEmitter-based platform listener that wraps Telegraf.
 * Delegates each lifecycle step to focused modules:
 *   - types.ts          → TelegramConfig, TelegramEmitter
 *   - slash-commands.ts → Command menu registration across broadcast scopes
 *   - handlers.ts       → All Telegraf update handler registrations
 *
 * Retry architecture:
 *   emitter.start() delegates to runManagedSession() (platform-runner.lib.ts) which
 *   owns the exponential-backoff loop (10 attempts, 3 s → 120 s), isLocked / isRetrying
 *   zombie guards, AbortController cancellation, and markActive / markInactive dashboard
 *   sync. This file provides only boot() and cleanup() hooks to the runner.
 *
 * Lifecycle (per Telegraf docs — all handlers must be registered BEFORE launch):
 *   1. Construct Telegraf instance
 *   2. Validate bot token (getMe) — 401 → runner classifies as auth error, no retry
 *   3. Register or clear slash command menu across all broadcast scopes
 *   4. Attach all update handlers (they emit typed events on the returned emitter)
 *   5. Call bot.launch() with allowedUpdates — polling starts here (webhook: createWebhook)
 */
import { EventEmitter } from 'events';
import { Telegraf } from 'telegraf';
import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import type { TelegramConfig, TelegramEmitter } from './types.js';
import { registerSlashMenu } from './slash-commands.js';
import { attachHandlers } from './handlers.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
// isAuthError retained — still needed inside boot() to classify long-poll errors mid-session.
// withRetry removed — runner (platform-runner.lib.ts) now owns the retry loop.
import { isAuthError } from '@/engine/lib/retry.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import { env } from '@/engine/config/env.config.js';
import {
  registerSlashSync,
  unregisterSlashSync,
} from '@/engine/modules/prefix/slash-sync.lib.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import {
  registerTelegramWebhookHandler,
  unregisterTelegramWebhookHandler,
} from '@/engine/modules/session/telegram-webhook.registry.js';
import { generateTelegramSecretToken } from '@/server/utils/hash.util.js';
import { botRepo } from '@/server/repos/bot.repo.js';
// Centralized retry runner — replaces the inline withRetry + AbortController boilerplate.
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';

/**
 * Creates a Telegram platform listener.
 * Register .on() handlers on the returned emitter BEFORE calling start().
 */
export function createTelegramListener(
  config: TelegramConfig,
): TelegramEmitter {
  const emitter = new EventEmitter() as TelegramEmitter;
  let activeBot: Telegraf | null = null;

  // Retained across start() calls so the slash-sync callback always references the current Map.
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.Telegram],
    sessionId: config.sessionId,
  });

  // Hoisted to factory scope — eliminates duplicate string construction in start() and stop().
  const smKey = `${config.userId}:${Platforms.Telegram}:${config.sessionId}`;

  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    /**
     * Tears down partial state between retry attempts.
     * Called by runManagedSession before each non-first attempt — never directly.
     */
    const cleanup = async (): Promise<void> => {
      unregisterSlashSync(smKey);
      unregisterTelegramWebhookHandler(`${config.userId}:${config.sessionId}`);
      activeCommands = null;
      if (activeBot) {
        try {
          activeBot.stop('Restarting');
        } catch {
          /* suppress "Bot is not running!" when start() set activeBot but aborted before launch() */
        }
        activeBot = null;
      }
    };

    /**
     * Platform-specific boot routine. Called once per retry attempt under markLocked.
     * markActive is NOT called here — runManagedSession calls it after boot() resolves.
     */
    const boot = async (): Promise<void> => {
      // Restore from the start() parameter on every attempt — cleanup() sets it to null.
      activeCommands = commands;

      sessionLogger.info('[telegram] Starting Listener...');

      // WHY: Fetching inside boot guarantees every attempt uses the latest DB credentials —
      // covers credential-update auto-restarts triggered via the dashboard.
      const botDetail = await botRepo.getById(config.userId, config.sessionId);
      const botToken = botDetail
        ? ((botDetail.credentials as any).telegramToken ?? config.botToken)
        : config.botToken;
      const prefix = botDetail
        ? (botDetail.prefix ?? config.prefix)
        : config.prefix;
      activeBot = new Telegraf(botToken);

      // Validate bot token before registering handlers or launching.
      // bot.launch() calls getMe() fire-and-forget — if it fails, the rejection escapes to
      // unhandledRejection and can crash every platform session. Calling getMe() here lets
      // the runner classify 401 → auth error → no retry (immediate permanent failure).
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
      attachHandlers(activeBot, emitter, prefix, config.userId, config.sessionId);

      // Catch errors thrown inside any Telegraf middleware or handler.
      // Without this, handler rejections surface as unhandledRejection which crashes
      // Node ≥15 and takes down every other platform session.
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
          // message_reaction is opt-in since Bot API 7.0 — must mirror allowedUpdates in long-poll.
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
        // Long-polling fallback — all handlers registered above, then launch().
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
            if (err instanceof Error && err.message === 'Bot is stopped!') return;
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

      // Register the slash-sync callback AFTER launch succeeds.
      // Closure captures activeBot and activeCommands by variable reference so dashboard
      // restarts bind to the current Telegraf instance without re-registering.
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
        // Explicitly typed — database exports can fall back to `any`
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
          true, // forceRegister — dashboard toggle changes the enabled-set, not the config hash
        );
      });
      // markActive NOT called here — runManagedSession calls it after boot() returns.
    };

    await runManagedSession({
      smKey,
      sessionLogger,
      label: '[telegram]',
      boot,
      cleanup,
    });
  };

  emitter.stop = async (signal?: string): Promise<void> => {
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[telegram] Stopping Listener...');
      unregisterSlashSync(smKey);
      // Remove webhook handler entry so server/app.ts returns 404 for this dead session
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