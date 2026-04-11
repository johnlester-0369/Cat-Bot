/**
 * Command Option Type Registry
 *
 * Maps each option type string to the method name it resolves to on Discord's
 * SlashCommandBuilder. Used in command module config.options[].type so
 * platform adapters can branch on the correct builder method without
 * comparing raw string literals scattered across the codebase.
 *
 * ── PERMANENT CONTRACT ─────────────────────────────────────────────────────────
 * Never change an existing value string.  All command module config objects
 * embed the string at runtime — changing a value would silently break every
 * command that references the old string without a compile-time error.
 * Only ever APPEND new entries at the bottom.
 *
 * Mapping:
 *   'string' → addStringOption  — free text input on all platforms
 *   'user'   → addUserOption    — Discord guild-member picker; resolves to user ID
 *                                 on other platforms treated as plain string input
 */

export const OptionType = Object.freeze({
  /**
   * Free text input.
   * Discord: addStringOption — accepts any text.
   * Telegram / Facebook: standard text argument.
   */
  string: 'string',

  /**
   * Discord guild-member picker.
   * Discord: addUserOption — renders a searchable user list in the slash menu;
   * interaction.options.getUser() resolves the selection to a User object whose
   * .id is extracted as a string for downstream OptionsMap compatibility.
   * Non-Discord platforms: falls back to plain text argument (the user types an ID).
   */
  user: 'user',
} as const);

/** Union of all valid option type value strings: 'string' | 'user' */
export type OptionTypeValue = (typeof OptionType)[keyof typeof OptionType];
