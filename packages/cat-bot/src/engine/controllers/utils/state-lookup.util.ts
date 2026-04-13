/**
 * State Entry Resolution — three-scope lookup for pending onReply and onReact states.
 *
 * Both reply.dispatcher.ts and react.dispatcher.ts previously duplicated the same
 * 12-line block to resolve a stateStore key across three scopes.  Centralising here
 * means:
 *   - A fourth scope (e.g. DM-global, session-wide) only requires one change
 *   - Unit tests cover the lookup logic once, not twice
 *   - The dispatcher files focus purely on routing, not on key arithmetic
 *
 * Scope priority (first non-null match wins):
 *   1. Private  — `${messageId}:${privateScopeId}` (senderID / userID)
 *      Only the user who triggered the original message can advance the flow.
 *   2. Public   — `${messageId}:${publicScopeId}`  (threadID)
 *      Any group member can advance — used for polls and shared conversation flows.
 *   3. Legacy   — bare `${messageId}`
 *      Backward-compat for states registered before composite keys were introduced.
 */

import { stateStore } from '@/engine/lib/state.lib.js';
import type { StateEntry } from '@/engine/lib/state.lib.js';

export interface StateResolution {
  /** The matched state entry — guaranteed non-null when StateResolution is returned. */
  stored: StateEntry;
  /**
   * The composite key that matched.  Dispatchers must use this exact key for any
   * subsequent stateStore mutations (delete, update) to avoid key mismatches.
   */
  lookupKey: string;
}

/**
 * Resolves a pending state across three key scopes, returning the first match.
 * Returns null when no state is registered for any scope.
 *
 * @param messageId      - Message ID that was replied-to or reacted-on
 * @param privateScopeId - User-scoped discriminator (senderID for replies; userID for reactions)
 * @param publicScopeId  - Thread-scoped discriminator — any group member can advance public flows
 */
export function resolveStateEntry(
  messageId: string,
  privateScopeId: string,
  publicScopeId: string,
): StateResolution | null {
  // Try private scope first — most flows are private; skip the two public Map lookups when matched
  const privateKey = `${messageId}:${privateScopeId}`;
  const privateStored = stateStore.get(privateKey);
  if (privateStored) return { stored: privateStored, lookupKey: privateKey };

  const publicKey = `${messageId}:${publicScopeId}`;
  const publicStored = stateStore.get(publicKey);
  if (publicStored) return { stored: publicStored, lookupKey: publicKey };

  // Legacy bare-messageID key — preserved for states registered before composite keys
  const legacyStored = stateStore.get(messageId);
  if (legacyStored) return { stored: legacyStored, lookupKey: messageId };

  return null;
}
