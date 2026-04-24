/**
 * kick-registry.lib.ts — Transient Kick Registry
 *
 * A lightweight in-memory registry that bridges the gap between explicit bot
 * removal commands (kick, badwords) and the log:unsubscribe event they trigger.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * When kick.ts or badwords.ts calls thread.removeUser(), the platform fires a
 * log:unsubscribe event. leave.ts subscribes to that event and sends a generic
 * "👋 A member has been removed" goodbye — which directly contradicts the
 * removal notification the triggering command already sent.
 *
 * The warn-ban guard in on-event.middleware.ts can suppress leave.ts via a DB
 * lookup (the user's ≥3 warns persist across events). No such persistent signal
 * exists for kick and badwords removals: the kick command leaves no DB trace,
 * and badwords.ts deletes the violation entry *after* removeUser() returns,
 * making a DB lookup unreliable due to async webhook timing.
 *
 * This registry solves the problem with a simple publish/consume pattern:
 *
 *   1. kick.ts / badwords.ts     → kickRegistry.register(threadID, uid)
 *      (called immediately before thread.removeUser())
 *   2. on-event.middleware.ts    → kickRegistry.consume(threadID, uid)
 *      (called inside the log:unsubscribe guard; returns true and clears the
 *       entry if found, signalling the middleware to suppress leave.ts)
 *
 * ── Memory safety ────────────────────────────────────────────────────────────
 * Each entry self-expires after TTL_MS (default 30 s) via setTimeout. This
 * guarantees no leak when a registered uid's log:unsubscribe event never arrives
 * (e.g. the bot lost admin before the removal completed, the platform dropped
 * the event, or the bot restarted mid-removal).
 *
 * ── Thread safety ────────────────────────────────────────────────────────────
 * Node.js is single-threaded; there are no concurrent write races. The only
 * interleaving risk is between the setTimeout cleanup and a consume() call, but
 * both operate on the same Map synchronously within a single event-loop tick.
 */

/** Milliseconds before an unconsumed entry is automatically evicted. */
const TTL_MS = 30_000;

/**
 * Inner map: uid → the NodeJS.Timeout handle for its auto-expiry timer.
 * Keeping the handle lets us cancel it early if consume() fires before TTL.
 */
type ThreadRegistry = Map<string, ReturnType<typeof setTimeout>>;

/** Outer map: threadID → per-thread uid registry */
const registry = new Map<string, ThreadRegistry>();

export const kickRegistry = {
  /**
   * Register a uid as "just removed by bot command" for the given thread.
   * Call this immediately before thread.removeUser() so the entry is visible
   * to the middleware when the resulting log:unsubscribe event is dispatched.
   *
   * Registering the same uid twice resets the expiry timer — the second removal
   * attempt will still correctly suppress leave.ts.
   */
  register(threadID: string, uid: string): void {
    if (!registry.has(threadID)) {
      registry.set(threadID, new Map());
    }

    const threadMap = registry.get(threadID)!;

    // Cancel any existing timer for this uid before setting a fresh one
    const existing = threadMap.get(uid);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      // Auto-evict: entry was never consumed (event never arrived or bot restarted)
      threadMap.delete(uid);
      if (threadMap.size === 0) registry.delete(threadID);
    }, TTL_MS);

    threadMap.set(uid, timer);
  },

  /**
   * Check whether a uid was registered for the given thread, then remove the entry.
   *
   * Returns true  → the uid was registered (removal was bot-driven); consume cancels
   *                 the auto-expiry timer and deletes the entry so it cannot fire twice.
   * Returns false → no matching entry; the departure was voluntary or driven by
   *                 a different subsystem (warn-ban is handled separately).
   *
   * This is a single-use check: calling consume() twice for the same uid returns
   * false on the second call, preventing duplicate suppression across event fan-out.
   */
  consume(threadID: string, uid: string): boolean {
    const threadMap = registry.get(threadID);
    if (!threadMap) return false;

    const timer = threadMap.get(uid);
    if (timer === undefined) return false;

    // Cancel the auto-expiry — entry is being consumed cleanly
    clearTimeout(timer);
    threadMap.delete(uid);
    if (threadMap.size === 0) registry.delete(threadID);

    return true;
  },
} as const;
