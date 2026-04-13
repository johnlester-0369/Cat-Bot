/**
 * State Store — In-Memory Conversation Flow Tracker
 *
 * Extracted from controllers/utils/state-lookup.util.ts as a stateful single-purpose utility.
 * Used by onReply and onReact dispatchers to track pending bot message states.
 *
 * Intentionally in-memory (Map) rather than persistent storage:
 *   - Reply flows are session-based; a bot restart resets in-progress conversations,
 *     which is acceptable UX for interactive CLI-style command flows.
 *   - Zero-latency synchronous reads avoid async overhead on every message_reply event.
 */

export interface StateEntry {
  command: string;
  // Scalar string for onReply step names; string[] for onReact accepted-emoji sets.
  state: string | string[];
  context: Record<string, unknown>;
}

const store = new Map<string, StateEntry>();

export const stateStore = {
  /**
   * Registers a pending state keyed by a composite or bare message ID.
   * Used by both onReply and onReact flows — the key format encodes scope.
   */
  create(id: string, data: StateEntry): void {
    store.set(id, data);
  },

  /**
   * Returns the registered state entry for a key, or null if none exists.
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
