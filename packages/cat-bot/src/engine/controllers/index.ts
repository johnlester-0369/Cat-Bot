/**
 * Controller Barrel — single public API surface for the controller layer.
 *
 * All platform listeners and app.ts import exclusively from this file.
 * Internal module structure (dispatchers/, handlers/, types.ts) is an
 * implementation detail — consumers never need to know about it.
 */

// Public types
export type {
  CommandModule,
  CommandMap,
  EventModuleMap,
  ParsedCommand,
  NativeContext,
  BaseCtx,
  AppCtx,
} from '@/engine/types/controller.types.js';

// Options — OptionsMap runtime class and OptionDef type for TypeScript command modules
// Re-exported from lib/ for backward compatibility with consumers that import from controllers
export { OptionsMap } from '@/engine/lib/options-map.lib.js';
export type { OptionDef } from '@/engine/lib/options-map.lib.js';

// Parsing
export { parseCommand } from '../utils/command-parser.util.js';

// Fan-out
export { runOnChat } from './on-chat-runner.js';

// Dispatchers
export { dispatchCommand } from './dispatchers/command.dispatcher.js';
export { dispatchEvent } from './dispatchers/event.dispatcher.js';

// Entry points
export { handleMessage } from './handlers/message.handler.js';
export { handleEvent } from './handlers/event.handler.js';
export { handleButtonAction } from './dispatchers/button.dispatcher.js';
