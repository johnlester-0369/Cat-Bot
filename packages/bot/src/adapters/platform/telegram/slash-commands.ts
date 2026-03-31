/**
 * Telegram — Slash Command Menu Registration
 *
 * Manages the Telegram Bot API command menu across all four broadcast-level
 * scopes. Telegram uses a 7-scope priority chain; we manage the four broadcast
 * scopes (default, all_private_chats, all_group_chats, all_chat_administrators)
 * to prevent stale entries from shadowing the default scope as fallbacks.
 *
 * Separated from listener.ts because command menu registration is an independent
 * concern that doesn't depend on handler wiring or launch configuration.
 */
import type { Telegraf } from 'telegraf';
import { logger } from '@/lib/logger.lib.js';

/** All four broadcast scopes that must be managed in lockstep to avoid stale menu entries. */
const BROADCAST_SCOPES = [
  { type: 'default' as const },
  { type: 'all_private_chats' as const },
  { type: 'all_group_chats' as const },
  { type: 'all_chat_administrators' as const },
] as const;

/**
 * Registers or clears the slash command menu across all Telegram broadcast scopes.
 *
 * When prefix is '/', commands exporting both config.name and config.description
 * are registered; otherwise all scopes are cleared to prevent stale menu entries
 * from persisting when the bot uses a non-slash prefix.
 */
export async function registerSlashMenu(
  bot: Telegraf,
  commands: Map<string, Record<string, unknown>>,
  prefix: string,
): Promise<void> {
  if (prefix === '/') {
    const slashCommands: Array<{ command: string; description: string }> = [];
    for (const [, mod] of commands) {
      if (typeof mod['onCommand'] !== 'function') continue;
      const cfg = mod['config'] as
        | { name?: string; description?: string }
        | undefined;
      if (!cfg?.name || !cfg?.description) continue;
      slashCommands.push({ command: cfg.name, description: cfg.description });
    }
    try {
      await Promise.all(
        BROADCAST_SCOPES.map((scope) =>
          bot.telegram.setMyCommands(slashCommands, { scope }),
        ),
      );
      logger.info(
        `[telegram] Registered ${slashCommands.length} command(s) across all Telegram scopes`,
      );
    } catch (err) {
      logger.warn('[telegram] setMyCommands failed (non-fatal)', {
        error: err,
      });
    }
  } else {
    // setMyCommands([]) marks a scope as "empty-list", shadowing lower-priority fallbacks.
    // We must clear all four broadcast scopes or previously-registered entries remain visible.
    try {
      await Promise.all(
        BROADCAST_SCOPES.map((scope) =>
          bot.telegram.setMyCommands([], { scope }),
        ),
      );
      logger.info(
        `[telegram] Cleared Telegram command menu (prefix "${prefix}" ≠ "/"; slash menu disabled)`,
      );
    } catch (err) {
      logger.warn(
        '[telegram] Failed to clear Telegram command menu (non-fatal)',
        { error: err },
      );
    }
  }
}
