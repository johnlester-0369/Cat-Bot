/**
 * Command Result Store — In-Memory Lookup for Intercepted Agent Command Outputs
 *
 * When the AI agent runs test_command, all platform API side-effects (replyMessage,
 * sendMessage, editMessage, etc.) are intercepted, normalized to JSON-safe format, and
 * stored here under a unique composite key. The agent reads the captured payload to
 * understand the full command output BEFORE deciding to deliver it, then calls
 * send_result with the key to replay those calls against the real platform API.
 *
 * This eliminates the blind two-step execute pattern where the agent had no visibility
 * into what execute_command would actually send before it was already sent.
 *
 * Key format: `${sessionUserId}:${platform}:${sessionId}:${autoIncrement}`
 * The per-prefix autoIncrement prevents key collisions across concurrent agent turns
 * within the same session (e.g., two agent turns in the same FB Messenger group).
 *
 * Intentionally in-memory — agent turn results are transient and tied to a single
 * agent lifecycle. A restart clears all pending entries, which is acceptable because
 * each agent turn completes synchronously within one request/response cycle.
 */

/**
 * A single intercepted UnifiedApi call, normalized to be fully JSON-serializable.
 *
 * The `args` array preserves the original positional signature of each UnifiedApi method:
 *   replyMessage  → [threadID: string, options: NormalizedReplyOptions]
 *   sendMessage   → [msg: string | NormalizedSendPayload, threadID: string]
 *   editMessage   → [messageID: string, options: NormalizedEditOptions]
 *   reactToMessage → [threadID: string, messageID: string, emoji: string]
 *   unsendMessage → [messageID: string]
 *   setNickname   → [threadID: string, userID: string, nickname: string]
 *   setGroupName  → [threadID: string, name: string]
 *   setGroupImage → [threadID: string, imageSource: unknown (sentinel if stream/Buffer)]
 *   removeGroupImage → [threadID: string]
 *   addUserToGroup   → [threadID: string, userID: string]
 *   removeUserFromGroup → [threadID: string, userID: string]
 *   setGroupReaction → [threadID: string, emoji: string]
 *
 * Streams and Buffers in args are replaced with STREAM_SENTINEL / BUFFER_SENTINEL
 * because they are single-use and cannot survive serialization or be replayed after
 * the mock proxy has already consumed them during the test_command execution.
 */
export interface InterceptedCall {
  /** UnifiedApi method name (e.g. 'replyMessage', 'sendMessage', 'editMessage'). */
  type: string;
  /** Normalized (JSON-safe) positional args matching the UnifiedApi method signature. */
  args: unknown[];
}

// ── Sentinel strings for non-serializable binary values ───────────────────────
// Stable exported constants so send_result can detect and skip binary fields
// when rebuilding replay options — avoids passing corrupt string values to platform APIs.
export const STREAM_SENTINEL =
  '[Stream: binary content — consumed during test, cannot be replayed]';
export const BUFFER_SENTINEL =
  '[Buffer: binary content — consumed during test, cannot be replayed]';

// ── Per-prefix autoincrement counters ─────────────────────────────────────────
// Tracks last-issued counter per `${sessionUserId}:${platform}:${sessionId}` prefix.
// Monotonically increasing within a process lifetime — no reset between agent turns.
const counters = new Map<string, number>();

// ── Result store ──────────────────────────────────────────────────────────────
// Maps composite lookup keys → their captured, normalized InterceptedCall arrays.
// Entries are removed by send_result after successful replay to prevent unbounded growth.
const resultStore = new Map<string, InterceptedCall[]>();

// ============================================================================
// NORMALIZER
// ============================================================================

/**
 * Recursively normalizes any value to be fully JSON-serializable.
 *
 * Handles:
 *   - Buffer             → BUFFER_SENTINEL
 *   - Readable stream    → STREAM_SENTINEL (duck-typed via .pipe — avoids importing 'stream')
 *   - bigint             → string representation
 *   - Arrays             → each element recursively normalized
 *   - Plain objects      → each value recursively normalized
 *   - Primitives / null  → returned as-is
 *
 * Does NOT import Node 'stream' to keep this file a zero-dependency leaf node.
 * Duck-typing on `.pipe` covers all Readable stream variants used by platform wrappers
 * (PassThrough, Transform, fs.ReadStream, etc.).
 */
export function normalizeToJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // Buffer.isBuffer must come before the general object check — Buffer extends Uint8Array
  if (Buffer.isBuffer(value)) return BUFFER_SENTINEL;

  // Readable stream duck-type: presence of .pipe is definitive for Node streams
  if (
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['pipe'] === 'function'
  ) {
    return STREAM_SENTINEL;
  }

  // BigInt is not JSON-serializable natively
  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) return value.map(normalizeToJson);

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeToJson(v);
    }
    return result;
  }

  return value;
}

// ============================================================================
// STORE API
// ============================================================================

export const commandResultStore = {
  /**
   * Generates a unique composite lookup key and advances the per-prefix counter.
   * Must be called exactly once per test_command invocation, immediately before store().
   *
   * Returns: `${sessionUserId}:${platform}:${sessionId}:${n}`
   * The n suffix is monotonically increasing — no two keys for the same session ever match.
   */
  generateKey(
    sessionUserId: string,
    platform: string,
    sessionId: string,
  ): string {
    const prefix = `${sessionUserId}:${platform}:${sessionId}`;
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}:${n}`;
  },

  /**
   * Stores normalized intercepted calls under the given key.
   * Overwrites any existing entry — keys are monotonically increasing so
   * overwrites indicate a bug; they should never occur in normal use.
   */
  set(key: string, calls: InterceptedCall[]): void {
    resultStore.set(key, calls);
  },

  /**
   * Retrieves stored intercepted calls by key.
   * Returns null when no entry exists (already consumed by send_result, or invalid key).
   */
  get(key: string): InterceptedCall[] | null {
    return resultStore.get(key) ?? null;
  },

  /**
   * Removes the entry for the given key after replay.
   * Called by send_result after delivering results to prevent memory accumulation.
   * Safe to call with a non-existent key (no-op).
   */
  delete(key: string): void {
    resultStore.delete(key);
  },
};