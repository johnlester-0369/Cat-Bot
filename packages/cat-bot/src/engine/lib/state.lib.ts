/**
 * State Store — In-Memory Conversation Flow Tracker
 *
 * Extracted from controllers/utils/state-lookup.util.ts as a stateful single-purpose utility.
 * Used by onReply and onReact dispatchers to track pending bot message states.
 *
 * TTL policy: 15-minute sliding window — conversation reply/react flows rarely outlast
 * a realistic human interaction session. Abandoned flows (user walked away mid-command)
 * auto-expire rather than leaking for the process lifetime.
 *
 * Intentionally in-memory (not persistent): a bot restart resetting in-progress
 * conversations is acceptable UX for interactive CLI-style command flows.
 */

import { TTLMap } from '@/engine/lib/ttl-map.lib.js';

export interface StateEntry {
  command: string;
  // Scalar string for onReply step names; string[] for onReact accepted-emoji sets.
  state: string | string[];
  context: Record<string, unknown>;
}

// 15-minute sliding TTL with a 5-minute background sweep. Sliding extends the window
// on every reply/react interaction, keeping multi-step flows alive as long as the
// user is actively engaged.
const store = new TTLMap<StateEntry>({
  ttlMs: 15 * 60 * 1000,
  sliding: true,
  cleanupIntervalMs: 5 * 60 * 1000,
});

export const stateStore = {
  /**
   * Registers a pending state keyed by a composite or bare message ID.
   * Used by both onReply and onReact flows — the key format encodes scope.
   */
  create(id: string, data: StateEntry): void {
    store.set(id, data);
  },

  /**
   * Returns the registered state entry for a key, or null if none exists or has expired.
   * In sliding mode, a successful get() resets the 15-minute TTL window.
   */
  get(id: string): StateEntry | null {
    return store.get(id) ?? null;
  },

  /**
   * Removes the registered state for a key.
   * Called by handlers after processing to prevent re-triggering on the same message.
   */
  delete(id: string): void {
    store.delete(id);
  },
};