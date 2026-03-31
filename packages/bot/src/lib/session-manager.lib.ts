/**
 * Session Manager — Orchestrates Multi-Session Lifecycle
 *
 * Centralized registry that holds `start` and `stop` references to all active
 * platform listener sessions, uniquely identified by `${userId}:${platform}:${sessionId}`.
 * Allows commands like `/restart` to target and reload a specific bot instance
 * independently, without affecting the orchestrator or other listeners.
 */

export interface SessionLifecycle {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

class SessionManager {
  readonly #sessions = new Map<string, SessionLifecycle>();

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
}

export const sessionManager = new SessionManager();
