/**
 * Session Manager — Orchestrates Multi-Session Lifecycle
 *
 * Centralized registry that holds `start` and `stop` references to all active
 * platform listener sessions, uniquely identified by `${userId}:${platform}:${sessionId}`.
 * Allows commands like `/restart` to target and reload a specific bot instance
 * independently, without affecting the orchestrator or other listeners.
 */

import { EventEmitter } from 'node:events';
import { botRepo } from '@/server/repos/bot.repo.js';

export interface SessionLifecycle {
  start: () => Promise<void>;
  stop: (signal?: string) => Promise<void>;
}

class SessionManager extends EventEmitter {
  readonly #sessions = new Map<string, SessionLifecycle>();
  // Tracks which session keys are currently running and their start timestamps (Date.now())
  // Key: `${userId}:${platform}:${sessionId}`
  readonly #active = new Map<string, number>();
  // Tracks sessions that are currently transitioning state (starting/stopping)
  readonly #locked = new Map<string, number>();
  // Tracks sessions currently inside a withRetry back-off loop.
  // Stored as { abort fn, unique token } — the token prevents a stale finally block
  // from a previous invocation from evicting a fresher entry when startBot() fires
  // a new retry sequence before the old one fully unwinds.
  readonly #retrying = new Map<string, { abort: () => void; token: symbol }>();

  
  markLocked(key: string): void {
    // WHY: Support reentrant locks so nested calls increment a counter instead of unlocking prematurely
    const count = this.#locked.get(key) ?? 0;
    this.#locked.set(key, count + 1);
    if (count === 0) {
      this.emit('locked', { key, locked: true });
    }
  }

  markUnlocked(key: string): void {
    const count = this.#locked.get(key) ?? 0;
    if (count <= 1) {
      this.#locked.delete(key);
      this.emit('locked', { key, locked: false });
    } else {
      this.#locked.set(key, count - 1);
    }
  }

  isLocked(key: string): boolean {
    return this.#locked.has(key);
  }

  getLockedBySessionId(sessionId: string): boolean {
    for (const key of this.#locked.keys()) {
      if (key.endsWith(`:${sessionId}`)) return true;
    }
    return false;
  }

  // ── Retry-state tracking ──────────────────────────────────────────────────────

  /**
   * Registers the session as inside a withRetry back-off loop and stores the abort
   * callback. Returns a unique symbol token that must be passed to markNotRetrying
   * to prevent a stale finally block from clearing a newer registration.
   */
  markRetrying(key: string, abort: () => void): symbol {
    const token = Symbol('retry-token');
    this.#retrying.set(key, { abort, token });
    return token;
  }

  /**
   * Clears retry state only when the stored token matches the caller's token.
   * Token-gating ensures that if startBot() calls markRetrying() before the old
   * startSessionWithRetry finally block fires, the new registration is preserved.
   */
  markNotRetrying(key: string, token: symbol): void {
    if (this.#retrying.get(key)?.token === token) {
      this.#retrying.delete(key);
    }
  }

  /** Returns true while the session is inside an active withRetry back-off loop. */
  isRetrying(key: string): boolean {
    return this.#retrying.has(key);
  }

  /**
   * Cancels the active back-off retry loop for the given session and returns true.
   * Returns false when the session was not in retry state (no-op safe).
   *
   * Called by startBot() so clicking Start during retry immediately cancels the loop
   * and boots a fresh transport with the latest credentials from the database.
   */
  abortRetry(key: string): boolean {
    const entry = this.#retrying.get(key);
    if (!entry) return false;
    entry.abort();
    this.#retrying.delete(key);
    return true;
  }

  /**
   * Register an active listener's lifecycle handles against its canonical key.
   */
  register(key: string, lifecycle: SessionLifecycle): void {
    this.#sessions.set(key, lifecycle);
  }

  /**
   * Gracefully stop and start a specific listener.
   */
  async restart(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) {
      throw new Error(`SessionManager: Session ${key} not found.`);
    }

    // Stop cleans up underlying sockets/polling/webhooks.
    await session.stop();
    // Start re-initializes them.
    await session.start();
  }
  /**
   * Stops a specific listener without restarting it.
   * Called by the management API on Stop — does NOT flip isRunning in the DB (service layer owns that).
   */
  async stop(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) {
      throw new Error(`SessionManager: Session ${key} not found.`);
    }
    await session.stop();
  }

  /**
   * Starts a previously stopped listener using its registered lifecycle handles.
   * Only works when the session registered itself before being stopped via stop().
   * If the session was never registered (process restart), the caller must spawn fresh.
   */
  async start(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) {
      throw new Error(`SessionManager: Session ${key} not found.`);
    }
    await session.start();
  }

  /**
   * Records a session as currently running, logs its start time for uptime tracking, and broadcasts the status change to
   * all Socket.IO subscribers. Called by platform adapters after successful start().
   */
  async markActive(key: string): Promise<void> {
    const now = Date.now();
    this.#active.set(key, now);
    this.emit('status', { key, active: true, startedAt: now });

    // Extract identifiers to sync running state directly into DB so crashes/stops reflect correctly
    const [userId, , sessionId] = key.split(':');
    if (userId && sessionId) {
      try {
        await botRepo.updateIsRunning(userId, sessionId, true);
      } catch (err) {
        console.error(
          `[session-manager] Failed to update isRunning=true for ${key}:`,
          err,
        );
      }
    }
  }

  /**
   * Removes a session from the active set and broadcasts the change. Called by
   * platform adapters in their stop wrappers and on permanent startup failure so
   * the dashboard never shows a dead session as online.
   */
  async markInactive(key: string): Promise<void> {
    this.#active.delete(key);
    this.emit('status', { key, active: false });

    const [userId, , sessionId] = key.split(':');
    if (userId && sessionId) {
      try {
        await botRepo.updateIsRunning(userId, sessionId, false);
      } catch (err) {
        console.error(
          `[session-manager] Failed to update isRunning=false for ${key}:`,
          err,
        );
      }
    }
  }

  /**
   * Returns true when the given full session key is currently marked as running.
   * Key format: `${userId}:${platform}:${sessionId}`
   */
  isActive(key: string): boolean {
    return this.#active.has(key);
  }

  /** Returns a snapshot of all currently active session keys. */
  getActiveKeys(): string[] {
    return [...this.#active.keys()];
  }

  /**
   * Returns true when any active key ends with the given sessionId segment.
   * Used by bot-monitor.socket.ts to answer status queries keyed by UUID
   * without requiring callers to reconstruct the full `userId:platform:sessionId` key.
   *
   * Safe because sessionId is a UUID (contains only `-` and hex chars — never `:`),
   * platform strings don't contain `:`, and cuid2 userId values don't contain `:`.
   */
  getStatusBySessionId(sessionId: string): boolean {
    for (const key of this.#active.keys()) {
      if (key.endsWith(`:${sessionId}`)) return true;
    }
    return false;
  }

  /** Returns the unix timestamp (ms) when the session was marked active by sessionId segment. */
  getStartTimeBySessionId(sessionId: string): number | null {
    for (const [key, startTime] of this.#active.entries()) {
      if (key.endsWith(`:${sessionId}`)) return startTime;
    }
    return null;
  }

  /** Returns the unix timestamp (ms) when the session was marked active, or null if inactive. */
  getStartTime(key: string): number | null {
    return this.#active.get(key) ?? null;
  }

  /** Returns the current uptime in milliseconds for the session, or null if inactive. */
  getUptime(key: string): number | null {
    const start = this.#active.get(key);
    return start !== undefined ? Date.now() - start : null;
  }

  /**
   * Removes a session from the registry. Useful when credentials change and the closure must be rebuilt.
   */
  async unregister(key: string): Promise<void> {
    this.#sessions.delete(key);
    if (this.#active.has(key)) await this.markInactive(key);
  }

  /**
   * Stops every transport session owned by a specific userId, run in parallel.
   * Called immediately when an account is banned so live bot transports halt before
   * any DB writes land — prevents in-flight events from executing on stale credentials.
   * Keys follow `userId:platform:sessionId`; prefix match is O(registered sessions).
   */
  async stopAllByUserId(userId: string, signal?: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [key, session] of this.#sessions.entries()) {
      if (key.startsWith(`${userId}:`)) {
        promises.push(
          session
            .stop(signal)
            .catch((err) =>
              console.error(
                `[session-manager] Failed to stop ${key} on user ban:`,
                err,
              ),
            ),
        );
      }
    }
    await Promise.all(promises);
  }

  /**
   * Removes all session registrations for a userId after stopAllByUserId completes.
   * Prevents stale closures from accumulating for banned accounts — the unban path
   * calls spawnDynamicSession which re-registers fresh lifecycle handles.
   */
  async unregisterAllByUserId(userId: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const key of [...this.#sessions.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.#sessions.delete(key);
        if (this.#active.has(key)) promises.push(this.markInactive(key));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Stops all active sessions. Used gracefully during process shutdown (SIGINT/SIGTERM).
   */
  async stopAll(signal?: string): Promise<void> {
    const promises = [];
    for (const [key, session] of this.#sessions.entries()) {
      promises.push(
        session
          .stop(signal)
          .catch((err) =>
            console.error(
              `[session-manager] Failed to stop session ${key}:`,
              err,
            ),
          ),
      );
    }
    await Promise.all(promises);
  }
}

export const sessionManager = new SessionManager();
