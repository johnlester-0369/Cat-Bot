/**
 * Shutdown Registry — Centralized Platform Session Stop Collector
 *
 * Solves the multi-session signal handler problem: when N sessions of the same
 * platform (e.g. 2 Discord bots, 3 Telegram bots) each register their own
 * process.once('SIGINT') / process.once('SIGTERM'), Node.js fires only the FIRST
 * one (process.once is single-fire) and the remaining sessions never clean up.
 * Additionally, stacking N handlers triggers MaxListenersExceededWarning above 10.
 *
 * Solution: each platform session calls shutdownRegistry.register(stopFn) during
 * start(). app.ts registers process.once() ONCE and iterates the full registry on
 * signal — every session teardown fires regardless of how many sessions are running.
 *
 * Dependency direction: lib/shutdown.lib.ts → (none)
 * Zero external imports keeps this a true leaf node — safe to import from any
 * layer without circular dependency risk.
 */

// ── Stop function type ────────────────────────────────────────────────────────

/**
 * A function that tears down a single platform session.
 * Receives the signal string so Telegram's bot.stop(reason) and similar APIs
 * can surface the correct reason to the transport library.
 */
export type StopFn = (signal: string) => void | Promise<void>;

// ── Registry ──────────────────────────────────────────────────────────────────

class ShutdownRegistry {
  readonly #handlers: StopFn[] = [];

  /**
   * Registers a stop function for one platform session.
   * Call this once per session inside start() — never at module load time —
   * so no handlers are registered before the connection is actually live.
   */
  register(fn: StopFn): void {
    this.#handlers.push(fn);
  }

  /**
   * Executes all registered stop functions sequentially.
   *
   * Sequential (not parallel) so each platform gets a clean teardown window
   * rather than racing. Errors are swallowed and logged so one failing handler
   * never prevents the remaining sessions from stopping.
   */
  async runAll(signal: string): Promise<void> {
    for (const fn of this.#handlers) {
      try {
        await fn(signal);
      } catch (err) {
        console.error('[shutdown] Stop handler failed:', err);
      }
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

/**
 * Singleton — all platform start() methods share this instance so every
 * registered stop function is reachable from the single process.once block in app.ts.
 */
export const shutdownRegistry = new ShutdownRegistry();
