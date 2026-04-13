/**
 * Session Manager — Orchestrates Multi-Session Lifecycle
 *
 * Centralized registry that holds `start` and `stop` references to all active
 * platform listener sessions, uniquely identified by `${userId}:${platform}:${sessionId}`.
 * Allows commands like `/restart` to target and reload a specific bot instance
 * independently, without affecting the orchestrator or other listeners.
 */

import { EventEmitter } from 'node:events';

export interface SessionLifecycle {
  start: () => Promise<void>;
  stop: (signal?: string) => Promise<void>;
}

class SessionManager extends EventEmitter {
  readonly #sessions = new Map<string, SessionLifecycle>();
  // Tracks which session keys are currently running and their start timestamps (Date.now())
  // Key: `${userId}:${platform}:${sessionId}`
  readonly #active = new Map<string, number>();

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
  markActive(key: string): void {
    const now = Date.now();
    this.#active.set(key, now);
    this.emit('status', { key, active: true, startedAt: now });
  }

  /**
   * Removes a session from the active set and broadcasts the change. Called by
   * platform adapters in their stop wrappers and on permanent startup failure so
   * the dashboard never shows a dead session as online.
   */
  markInactive(key: string): void {
    this.#active.delete(key);
    this.emit('status', { key, active: false });
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
  unregister(key: string): void {
    this.#sessions.delete(key);
    if (this.#active.has(key)) this.markInactive(key);
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
