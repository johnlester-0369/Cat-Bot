/**
 * Agent Command Guard — AI-readable middleware constraint inspector
 *
 * Provides structured, LLM-interpretable feedback about command execution
 * constraints BEFORE the command runs. Unlike the standard onCommand middleware
 * chain (which silently blocks via next() or sends opaque chat replies the LLM
 * cannot read), this guard returns a typed result the agent can embed verbatim
 * in its natural-language reply to the user.
 *
 * Guard order mirrors the onCommand middleware pipeline registered in middleware/index.ts:
 *   1. Bot admin bypass   — admins skip bans and cooldown (same as enforceNotBanned)
 *   2. User ban check     — silent drop in standard chain; explicit reason string here
 *   3. Thread ban check   — same
 *   4. Permission (role)  — THREAD_ADMIN / BOT_ADMIN gates (mirrors enforcePermission)
 *   5. Cooldown           — returns remaining seconds so the AI can quote the wait time
 *
 * WHY separate from on-command.middleware.ts:
 *   Standard middlewares are designed for end-user UX: they send chat messages and
 *   return void without surfacing metadata. The agent needs a structured return value
 *   it can read and translate into a conversational explanation rather than a generic
 *   "execution was blocked by the system" fallback.
 *
 * Fail strategy:
 *   - Ban checks:        fail-open  — a temporary DB outage should not lock out users
 *   - Permission checks: fail-closed — a false-positive grant is a security issue
 *   - Admin bypass:      fail-open  — unknown admin status = no bypass applied
 */

import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { Role } from '@/engine/constants/role.constants.js';

// ── Result type ───────────────────────────────────────────────────────────────

export interface CommandGuardResult {
  /** Whether the command is permitted to execute for this user in this context. */
  allowed: boolean;
  /**
   * Human-readable explanation the AI agent can quote directly in its reply.
   * null when allowed === true — no message needed.
   */
  reason: string | null;
  details?: {
    /** Seconds remaining until the cooldown window expires (cooldown blocks only). */
    cooldownRemainingSeconds?: number;
    /** Minimum role label required by the command (permission blocks only). */
    requiredRole?: string;
    /** Which entity triggered the ban (ban blocks only). */
    bannedEntity?: 'user' | 'thread';
  };
}

// ── Guard function ────────────────────────────────────────────────────────────

/**
 * Inspects command execution constraints without sending chat messages or
 * advancing a middleware chain — pure check, structured return value.
 *
 * @param mod           - Command module object (must expose `config` with role/cooldown)
 * @param commandName   - Canonical lowercase command name (cooldown key prefix)
 * @param senderID      - Platform user ID of the invoking user
 * @param threadID      - Platform thread/channel ID
 * @param sessionUserId - Bot owner user ID from session directory path
 * @param platform      - Platform string (e.g. 'discord', 'telegram', 'facebook-messenger')
 * @param sessionId     - Bot session ID from session directory path
 */
export async function inspectCommandConstraints(
  mod: Record<string, unknown>,
  commandName: string,
  senderID: string,
  threadID: string,
  sessionUserId: string,
  platform: string,
  sessionId: string,
): Promise<CommandGuardResult> {
  const cfg = mod['config'] as Record<string, unknown> | undefined;

  // ── Bot admin bypass ───────────────────────────────────────────────────────
  // Mirrors the admin short-circuit in enforceNotBanned: bot admins are exempt from
  // ban enforcement and cooldown consumption so management commands are never throttled.
  let isAdmin = false;
  if (sessionUserId && sessionId && senderID) {
    try {
      isAdmin = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
    } catch {
      // Fail-open — treat as non-admin; subsequent checks apply normally
    }
  }

  if (!isAdmin) {
    // ── User ban check ───────────────────────────────────────────────────────
    // Standard middleware drops silently; guard surfaces the reason so the AI
    // can tell the user they are banned without guessing from a void return.
    if (senderID && sessionUserId && sessionId) {
      try {
        const banned = await isUserBanned(sessionUserId, platform, sessionId, senderID);
        if (banned) {
          return {
            allowed: false,
            reason: 'You are currently banned from using bot commands in this session.',
            details: { bannedEntity: 'user' },
          };
        }
      } catch {
        // Fail-open — cannot confirm ban status; proceed to other checks
      }
    }

    // ── Thread ban check ─────────────────────────────────────────────────────
    if (threadID && sessionUserId && sessionId) {
      try {
        const banned = await isThreadBanned(sessionUserId, platform, sessionId, threadID);
        if (banned) {
          return {
            allowed: false,
            reason: 'This thread is currently banned from using bot commands.',
            details: { bannedEntity: 'thread' },
          };
        }
      } catch {
        // Fail-open
      }
    }
  }

  // ── Permission (role) check ────────────────────────────────────────────────
  // Fail-closed: DB errors deny rather than grant — a false-positive grant bypasses
  // the bot owner's access control decisions, which is a worse outcome than a false deny.
  const roleRequired = (
    typeof cfg?.['role'] === 'number' ? cfg['role'] : Role.ANYONE
  ) as number;

  if (roleRequired === Role.THREAD_ADMIN) {
    let allowed = false;
    try {
      allowed = await isThreadAdmin(threadID, senderID);
    } catch { /* fail-closed — deny on DB error */ }

    // Bot admins implicitly inherit thread admin privileges across all threads —
    // mirrors the escalation logic in enforcePermission middleware.
    if (!allowed && sessionUserId && sessionId) {
      try {
        allowed = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
      } catch { /* fail-closed */ }
    }

    if (!allowed) {
      return {
        allowed: false,
        reason: 'This command requires thread administrator privileges.',
        details: { requiredRole: 'Thread Administrator' },
      };
    }
  } else if (roleRequired === Role.BOT_ADMIN) {
    let allowed = false;
    if (sessionUserId && sessionId) {
      try {
        allowed = await isBotAdmin(sessionUserId, platform, sessionId, senderID);
      } catch { /* fail-closed */ }
    }

    if (!allowed) {
      return {
        allowed: false,
        reason: 'This command requires bot administrator privileges.',
        details: { requiredRole: 'Bot Administrator' },
      };
    }
  }

  // ── Cooldown check ─────────────────────────────────────────────────────────
  // Bot admins bypass cooldown — they need unrestricted access for management.
  // When allowed, the window is consumed so the agent execution counts as a real
  // invocation for rate-limiting purposes (prevents AI from bypassing user throttles).
  if (!isAdmin) {
    const cooldownSec = (
      typeof cfg?.['cooldown'] === 'number' ? cfg['cooldown'] : 0
    ) as number;

    if (cooldownSec > 0 && senderID) {
      const key = `${commandName}:${senderID}`;
      const now = Date.now();
      cooldownStore.pruneIfNeeded(now);
      const entry = cooldownStore.check(key, now);

      if (entry !== null) {
        // Surfaces remaining seconds so the LLM can tell the user exactly how long to wait
        // rather than a generic "on cooldown" message with no actionable timing information.
        const remainingSec = Math.ceil((entry.expiry - now) / 1000);
        return {
          allowed: false,
          reason: `This command is on cooldown. Please wait ${remainingSec} second${remainingSec !== 1 ? 's' : ''} before trying again.`,
          details: { cooldownRemainingSeconds: remainingSec },
        };
      }

      // Register the cooldown window at check time — not after handler completion —
      // so concurrent agent invocations of the same command are correctly throttled.
      cooldownStore.record(key, now, cooldownSec * 1000);
    }
  }

  return { allowed: true, reason: null };
}