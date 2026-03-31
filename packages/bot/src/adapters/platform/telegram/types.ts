/**
 * Telegram Platform — Type Definitions
 *
 * Centralises all Telegram-specific types in one file so they can be
 * consumed without pulling in Telegraf or handler dependencies.
 *
 * Separated from listener.ts because:
 *   - adapters/platform/index.ts needs PLATFORM_ID for the union type
 *   - External consumers may need TelegramConfig for type annotations
 *   - Neither should trigger Telegraf's module-level side effects
 */
import type { EventEmitter } from 'events';

export interface TelegramConfig {
  botToken: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/** EventEmitter augmented with the typed start() lifecycle method. */
export type TelegramEmitter = EventEmitter & {
  start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
  stop: () => Promise<void>;
};
