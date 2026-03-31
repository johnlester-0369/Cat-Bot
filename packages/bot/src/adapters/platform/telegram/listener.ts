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
import { logger } from '@/lib/logger.lib.js';
import type { TelegramConfig, TelegramEmitter } from './types.js';
import { registerSlashMenu } from './slash-commands.js';
import { attachHandlers } from './handlers.js';
import { shutdownRegistry } from '@/lib/shutdown.lib.js';

/**
 * Creates a Telegram platform listener.
 * Register .on() handlers on the returned emitter BEFORE calling start().
 */
export function createTelegramListener(
  config: TelegramConfig,
): TelegramEmitter {
  const emitter = new EventEmitter() as TelegramEmitter;
  let activeBot: Telegraf | null = null;

  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    logger.info('[telegram] Starting...');

    activeBot = new Telegraf(config.botToken);

    // Step 1: Register or clear slash command menu across all broadcast scopes
    await registerSlashMenu(activeBot, commands, config.prefix);

    // Step 2: Attach all update handlers — must happen before bot.launch()
    attachHandlers(
      activeBot,
      emitter,
      config.prefix,
      config.userId,
      config.sessionId,
    );

    // Step 3: Launch polling — starts only after all handlers are registered
    // Per https://telegraf.js.org/: "this should ideally be written before bot.launch()"
    activeBot.launch({
      // message_reaction and message_reaction_count are opt-in since Bot API 7.0 —
      // Telegram does not deliver them unless explicitly requested here.
      allowedUpdates: [
        'message',
        'message_reaction',
        'message_reaction_count',
        'callback_query',
      ],
    });
    logger.info('[telegram] Bot running.');

    // bot.stop registered with central shutdown registry — app.ts fires on SIGINT/SIGTERM
    // so multiple Telegram sessions never stack duplicate process.once listeners.
    shutdownRegistry.register((signal) => activeBot?.stop(signal));

    logger.info('[telegram] Listener active');
  };

  emitter.stop = async (): Promise<void> => {
    if (activeBot) {
      activeBot.stop('Restarting');
      activeBot = null;
    }
  };

  return emitter;
}
