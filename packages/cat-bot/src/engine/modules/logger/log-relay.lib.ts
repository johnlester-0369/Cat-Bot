/**
 * Log Relay — Winston → Socket.IO Bridge
 *
 * A zero-dependency EventEmitter that decouples the Winston logger from the
 * Socket.IO server. The logger emits to this relay; bot-monitor.socket.ts
 * subscribes and forwards to connected clients.
 *
 * Why a relay rather than a direct import of socket.lib?
 *   logger.lib.ts is imported very early (before the HTTP server is created).
 *   A direct socket.lib import would create a circular boot-order dependency.
 *   The relay fires-and-forgets — entries emitted before any Socket.IO subscriber
 *   is attached are silently dropped outside the sliding-window history buffer.
 *
 * Each emitted value is a single pre-formatted ANSI string — identical to what
 * Winston's devFormat prints to the terminal. The web client renders it via
 * ansi-to-react so the dashboard console mirrors the server terminal exactly.
 */

import { EventEmitter } from 'node:events';

// ── Singleton ─────────────────────────────────────────────────────────────────

class LogRelay extends EventEmitter {
  readonly #MAX_HISTORY = 100;
  // Per-session sliding windows — keyed by `${userId}:${platformId}:${sessionId}` so the
  // bot detail page can hydrate its console with only that session's buffered history.
  readonly #keyedHistory = new Map<string, Array<{ format: () => string; cached?: string }>>();
  // Tracks active Socket.IO subscriber count per session key. When zero, emitKeyed skips
  // the EventEmitter dispatch entirely — no bandwidth wasted on unwatched sessions.
  readonly #subscribers = new Map<string, number>();

  /**
   * Enqueues a lazy format closure in the per-session sliding window for `key`.
   * The closure is invoked only when a subscriber is actively watching (live emit) or
   * when `getKeyedHistory` is called (hydration) — chalk rendering never runs for idle sessions.
   * Key format matches session-logger: `${userId}:${platformId}:${sessionId}`.
   */
  emitKeyed(key: string, format: () => string): void {
    // Store as a lazy entry — the format closure is cheap to enqueue and captures the same
    // raw data that would otherwise be pre-rendered into a 150–300 char ANSI string. Idle
    // sessions accumulate compact closures in the ring buffer instead of rendered strings.
    const entry: { format: () => string; cached?: string } = { format };
    const hist = this.#keyedHistory.get(key) ?? [];
    hist.push(entry);
    if (hist.length > this.#MAX_HISTORY) hist.shift();
    this.#keyedHistory.set(key, hist);
    // Invoke the closure and broadcast only when a subscriber is watching — this is the
    // sole code path where chalk formatting runs for an idle (unsubscribed) session's entry.
    if ((this.#subscribers.get(key) ?? 0) > 0) {
      const formatted = format();
      entry.cached = formatted;                    // cache so getKeyedHistory re-uses the same string
      this.emit('log:keyed', { key, entry: formatted });
    }
  }

  /** Lazily formats and returns the per-session sliding window for hydrating a newly subscribed client. */
  getKeyedHistory(key: string): string[] {
    // `??=` formats and caches on first access; subsequent calls return the pre-rendered string.
    // Idle entries (never seen by a subscriber) are formatted exactly once here, on hydration.
    return (this.#keyedHistory.get(key) ?? []).map((e) => (e.cached ??= e.format()));
  }

  /**
   *  subscribe hydration delivers only post-restart logs, not stale pre-restart entries. */
  clearKeyedHistory(key: string): void {
    this.#keyedHistory.delete(key);
  }

  /**
   * Increments the subscriber count for a session key. Called by bot-monitor.socket.ts
   * when a client joins the bot-log room — enables live emission in emitKeyed.
   */
  addSubscriber(key: string): void {
    this.#subscribers.set(key, (this.#subscribers.get(key) ?? 0) + 1);
  }

  /**
   * Decrements the subscriber count. Called on unsubscribe and socket disconnect.
   * Dropping to zero means emitKeyed will skip the EventEmitter dispatch again.
   */
  removeSubscriber(key: string): void {
    const count = this.#subscribers.get(key) ?? 0;
    if (count <= 1) {
      this.#subscribers.delete(key);
    } else {
      this.#subscribers.set(key, count - 1);
    }
  }

  /** Returns true when at least one Socket.IO client is subscribed to this session's logs. */
  isConnected(key: string): boolean {
    return (this.#subscribers.get(key) ?? 0) > 0;
  }
}

/**
 * Singleton log relay. Increase max listeners to accommodate multiple
 * Socket.IO namespace subscribers without triggering Node's memory-leak warning.
 */
export const logRelay = new LogRelay();
