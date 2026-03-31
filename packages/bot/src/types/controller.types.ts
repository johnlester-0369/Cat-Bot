/**
 * Shared type definitions for the controller layer.
 *
 * Centralised here so every dispatcher, handler, and utility shares the same
 * contract — prevents subtle type drift when new entry points are added.
 */

import type { UnifiedApi } from '@/adapters/models/api.model.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '@/adapters/models/context.model.js';

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
}
