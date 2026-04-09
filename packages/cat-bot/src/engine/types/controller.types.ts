/**
 * Shared type definitions for the controller layer.
 *
 * Centralised here so every dispatcher, handler, and utility shares the same
 * contract — prevents subtle type drift when new entry points are added.
 */

import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/engine/adapters/models/context.model.js';
import type { StateContext } from '@/engine/adapters/models/context.model.js';
import type { SessionLogger } from '@/engine/lib/logger.lib.js';
import type { OptionsMap } from '@/engine/lib/options-map.lib.js';
import type { CollectionManager } from '@/engine/lib/db-collection.lib.js';

/** A command module loaded from src/modules/commands/ */
export type CommandModule = Record<string, unknown>;

/** A map of command name → command module */
export type CommandMap = Map<string, CommandModule>;

/** A map of event type → array of event handler modules */
export type EventModuleMap = Map<string, Array<CommandModule>>;

/** Parsed result of a prefix-stripped command line. */
export interface ParsedCommand {
  name: string;
  args: string[];
}

/** Minimal native context passed alongside every event */
export interface NativeContext {
  platform: string;
  /** Top-level user directory from session/{userId}/ — identifies the credential namespace. */
  userId?: string;
  /** Session directory from session/{userId}/{platform}/{sessionId}/ — identifies the account. */
  sessionId?: string;
  [key: string]: unknown;
}

/** Base context object injected into every command/event handler */
export interface BaseCtx {
  api: UnifiedApi;
  event: Record<string, unknown>;
  commands: CommandMap;
  prefix?: string;
  thread: ReturnType<typeof createThreadContext>;
  chat: ReturnType<typeof createChatContext>;
  bot: ReturnType<typeof createBotContext>;
  user: ReturnType<typeof createUserContext>;
  native: NativeContext;
  logger: SessionLogger;

  // WHY: Provides uniform database queries across all command modules natively inside ctx
  db: {
    users: {
      getName: (userId: string) => Promise<string>;
      /** Returns a CollectionManager bound to the calling user's bot_users_session row. */
      collection: (botUserId: string) => CollectionManager;
      /** Returns all bot_users_session records for the current bot session. */
      getAll: () => Promise<Array<{ botUserId: string; data: Record<string, unknown> }>>;
    };
    threads: {
      getName: (threadId: string) => Promise<string>;
      /** Returns a CollectionManager bound to the calling thread's bot_threads_session row. */
      collection: (botThreadId: string) => CollectionManager;
    };
  };
}

/** 
 * Universal Context — a single unified type for all handler functions 
 * (`onCommand`, `onChat`, `onReply`, `onReact`, `onEvent`).
 * 
 * Contains all properties from BaseCtx plus the properties dynamically injected
 * by the various dispatchers depending on the event lifecycle.
 */
export interface AppCtx extends BaseCtx {
  /** Arguments parsed from the command (available in onCommand). */
  args: string[];
  /** Parsed command options (available in onCommand). */
  options: OptionsMap;
  /** The parsed command metadata (available in onCommand). */
  parsed: ParsedCommand;
  /** The state context for registering pending flows (available in onCommand, onReply, onReact). */
  state: StateContext['state'];
  /** The active session data for the current flow (available in onReply, onReact). */
  session: { id: string; context: Record<string, unknown> };
  /** The reaction emoji (available in onReact). */
  emoji: string;
  /** The target message ID (available in onReact). */
  messageID: string;
}
