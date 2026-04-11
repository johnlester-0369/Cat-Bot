/**
 * Role Level Registry
 *
 * Maps each role level to a compact integer used in command module config.role fields
 * and enforced by enforcePermission middleware in src/middleware/on-command.middleware.ts.
 *
 * ── PERMANENT CONTRACT ─────────────────────────────────────────────────────────
 * Never change an existing number. Role levels are embedded in dynamically-loaded
 * command module config objects at runtime — changing them would silently
 * break any command written against the old value without a compile-time error.
 * Only ever APPEND new entries at the bottom.
 *
 * Mapping:
 *   0  ANYONE       — any user can invoke the command (default)
 *   1  THREAD_ADMIN — only platform thread admins can invoke
 *   2  BOT_ADMIN    — only bot admins provisioned via the web dashboard can invoke
 */

export const Role = {
  /** Any user can invoke this command — no privilege check performed. */
  ANYONE: 0,
  /** Only platform thread admins (bot_threads.admins relation) can invoke. */
  THREAD_ADMIN: 1,
  /** Only bot admins (BotAdmin table for this owner session) can invoke. */
  BOT_ADMIN: 2,
} as const;

/** Union of all valid role level values: 0 | 1 | 2 */
export type RoleLevel = (typeof Role)[keyof typeof Role];
