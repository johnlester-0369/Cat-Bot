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
  // Sliding window of raw ANSI strings — one entry per log line, same as terminal output
  readonly #MAX_HISTORY = 100;
  readonly #history: string[] = [];
  // Per-session sliding windows — keyed by `${userId}:${platformId}:${sessionId}` so the
  // bot detail page can hydrate its console with only that session's buffered history.
  readonly #keyedHistory = new Map<string, string[]>();

  constructor() {
    super();
    this.on('log', (entry: string) => {
      this.#history.push(entry);
      if (this.#history.length > this.#MAX_HISTORY) {
        this.#history.shift();
      }
    });
  }

  getHistory(): string[] {
    return [...this.#history];
  }

  /**
   * Stores `entry` in the per-session sliding window for `key` and emits 'log:keyed'
   * so bot-monitor.socket.ts can forward the entry to the session-specific Socket.IO room.
   * Key format matches session-logger: `${userId}:${platformId}:${sessionId}`.
   */
  emitKeyed(key: string, entry: string): void {
    const hist = this.#keyedHistory.get(key) ?? [];
    hist.push(entry);
    if (hist.length > this.#MAX_HISTORY) hist.shift();
    this.#keyedHistory.set(key, hist);
    this.emit('log:keyed', { key, entry });
  }

  /** Returns a copy of the per-session sliding window for hydrating a newly subscribed client. */
  getKeyedHistory(key: string): string[] {
    return [...(this.#keyedHistory.get(key) ?? [])];
  }

  /** Wipes the per-session sliding window. Called on bot stop/restart so the next
   *  subscribe hydration delivers only post-restart logs, not stale pre-restart entries. */
  clearKeyedHistory(key: string): void {
    this.#keyedHistory.delete(key);
  }
}

/**
 * Singleton log relay. Increase max listeners to accommodate multiple
 * Socket.IO namespace subscribers without triggering Node's memory-leak warning.
 */
export const logRelay = new LogRelay();
