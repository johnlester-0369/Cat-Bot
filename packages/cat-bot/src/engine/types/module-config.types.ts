/**
 * Module Config Type Definitions — CommandConfig & EventConfig
 *
 * Typed contracts for command and event module config exports.
 * Command modules in src/app/commands/ and event modules in src/app/events/
 * were previously untyped (Record<string, unknown>) in the module loader —
 * these interfaces provide compile-time safety and IDE autocomplete for
 * module authors without changing any runtime behaviour.
 *
 * Usage in a command module:
 *
 *   import type { CommandConfig } from '@/engine/types/module-config.types.js';
 *
 *   export const config: CommandConfig = {
 *     name: 'ping',
 *     version: '1.0.0',
 *     role: Role.ANYONE,
 *     author: 'John Lester',
 *     description: 'Responds with pong',
 *     usage: '',
 *     cooldown: 5,
 *   };
 *
 * Usage in an event module:
 *
 *   import type { EventConfig } from '@/engine/types/module-config.types.js';
 *
 *   export const config: EventConfig = {
 *     name: 'join',
 *     eventType: ['log:subscribe'],
 *     version: '1.0.0',
 *     author: 'John Lester',
 *     description: 'Sends a welcome message when members join the group',
 *   };
 */

import type { RoleLevel } from '@/engine/constants/role.constants.js';
import type { OptionTypeValue } from '@/engine/modules/command/command-option.constants.js';
import type { PlatformName } from '@/engine/modules/platform/platform.constants.js';

// ── CommandOption ─────────────────────────────────────────────────────────────

/**
 * Shape of each entry in a command's config.options array.
 *
 * Mirrors Discord's SlashCommandOption fields that matter for cross-platform parity.
 * Parsed by validateCommandOptions middleware and exposed as ctx.options (OptionsMap)
 * inside the onCommand handler.
 */
export interface CommandOption {
  /**
   * Option type — controls how Discord renders the field in the '/' menu.
   * Use OptionType.string for free-text inputs; OptionType.user for the
   * guild-member picker (falls back to plain text on non-Discord platforms).
   */
  type: OptionTypeValue;

  /**
   * Option name — used as the key in key:value message parsing and
   * options.get() lookups. Must be lowercase (normalised at load time).
   */
  name: string;

  /** Human-readable description shown in Discord's '/' menu and usage error messages. */
  description?: string;

  /** When true, the command is rejected with a usage error if this option is absent. */
  required?: boolean;
}

// ── CommandConfig ─────────────────────────────────────────────────────────────

/**
 * Typed contract for command module config exports.
 *
 * Mandatory properties are the minimum set required by the module loader
 * (app.ts loadCommands) and the unified middleware pipeline. Optional properties
 * are safe to omit — each consumer falls back to a documented default.
 */
export interface CommandConfig {
  // ── Mandatory ──────────────────────────────────────────────────────────────

  /** Command name (lowercase). Matched against the prefix-stripped token. */
  name: string;

  /** Semantic version string (e.g. '1.0.0'). Shown in help and audit output. */
  version: string;

  /**
   * Minimum role level required to invoke the command.
   * Enforced by enforcePermission middleware before onCommand executes.
   * Use Role.ANYONE (0) for public commands.
   */
  role: RoleLevel;

  /** Author name or handle — shown in help output and error context. */
  author: string;

  /** One-line description of what the command does — shown in Discord's '/' menu. */
  description: string;

  /**
   * Usage pattern string or array of pattern strings.
   * Shown in the auto-generated usage reply when ctx.usage() is called.
   * A single string (e.g. '<add|list|delete> [uid]') renders as one usage line.
   * An array renders each item as its own prefixed bullet line — useful for
   * commands with 2–3 distinct signatures that do not warrant a full guide[].
   * Commands that use config.guide[] instead may supply an empty string here.
   */
  usage?: string | string[];

  /** Per-user cooldown in seconds. Enforced by cooldown middleware. */
  cooldown: number;

  // ── Optional ───────────────────────────────────────────────────────────────

  /**
   * Alternative command names that map to the same onCommand handler.
   * Each alias is registered as a separate key in the CommandMap at load time;
   * alias names are lowercased automatically.
   */
  aliases?: string[];

  /**
   * Whether this command requires the configured prefix to trigger.
   * Defaults to true when absent. Set to false for prefix-free commands
   * (rare — most bots use a consistent prefix).
   */
  hasPrefix?: boolean;

  /**
   * Display category for grouping in help output (e.g. 'Admin', 'Fun', 'Utility').
   * Not used by the dispatcher — purely cosmetic.
   */
  category?: string;

  /**
   * Platform allowlist. When present and non-empty, the command only runs on
   * the listed platform IDs. Absent or empty array → runs on all platforms.
   * Enforced by isPlatformAllowed() in syncCommandsAndEvents and command dispatch.
   */
  platform?: PlatformName[];

  /**
   * Typed option definitions for named key:value argument parsing.
   * Parsed by validateCommandOptions middleware; results exposed as ctx.options.
   * Drives Discord's '/' slash menu option fields.
   */
  options?: CommandOption[];

  /**
   * Structured usage guide: each string is an arg pattern line displayed
   * in the usage reply (e.g. ['<add> <uid>', '<list>', '<delete> <uid>']).
   * Takes precedence over the legacy `usage` string when present.
   */
  guide?: string[];
}

// ── EventConfig ───────────────────────────────────────────────────────────────

/**
 * Typed contract for event module config exports.
 *
 * Event modules live in src/app/events/ and are keyed by eventType[] in the
 * EventModuleMap. The module loader (app.ts loadEventModules) validates
 * name and eventType before registering the module.
 */
export interface EventConfig {
  // ── Mandatory ──────────────────────────────────────────────────────────────

  /** Event handler name (lowercase). Registered in eventRegistry for dashboard listing. */
  name: string;

  /**
   * Unified event type strings this handler subscribes to.
   * The module is registered under every type in this array — one file may handle
   * multiple event types (e.g. ['log:subscribe', 'log:unsubscribe']).
   * Values correspond to UnifiedEvent.eventType from event.model.ts.
   */
  eventType: string[];

  /** Semantic version string (e.g. '1.0.0'). */
  version: string;

  /** Author name or handle — shown in dashboard and audit output. */
  author: string;

  /** One-line description of what this event handler does. */
  description: string;

  // ── Optional ───────────────────────────────────────────────────────────────

  /**
   * Platform allowlist — same semantics as CommandConfig.platform.
   * When present and non-empty, the event handler only runs on listed platforms.
   */
  platform?: PlatformName[];
}
