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
 *   1  THREAD_ADMIN — accessible by: THREAD_ADMIN, PREMIUM, BOT_ADMIN, SYSTEM_ADMIN
 *   2  PREMIUM      — accessible by: PREMIUM, BOT_ADMIN, SYSTEM_ADMIN (thread admins do NOT qualify)
 *   3  BOT_ADMIN    — accessible by: BOT_ADMIN, SYSTEM_ADMIN only
 *
 * Numeric ordering is intentional: higher value = stricter gate and greater authority.
 * A role can always invoke commands requiring a lower-numbered role.
 * Exception: ANYONE (0) commands are accessible by every role — the ANYONE gate is a no-op.
 */

export const Role = {
  /** Any user can invoke this command — no privilege check performed. */
  ANYONE: 0,
  /** Accessible by: thread/group admins, PREMIUM, BOT_ADMIN, SYSTEM_ADMIN. ANYONE alone is denied. */
  THREAD_ADMIN: 1,
  /** Accessible by: premium users, BOT_ADMIN, SYSTEM_ADMIN. Thread admins alone are denied. */
  PREMIUM: 2,
  /** Accessible by: bot admins (BotAdmin table for this owner session) and SYSTEM_ADMIN only.
   *  Thread admins and premium-only users are both denied. */
  BOT_ADMIN: 3,
  /** Only system admins (configured globally) can invoke; highest authority across all bots. */
  SYSTEM_ADMIN: 4,
} as const;

/** Union of all valid role level values: 0 | 1 | 2 | 3 | 4 */
export type RoleLevel = (typeof Role)[keyof typeof Role];
