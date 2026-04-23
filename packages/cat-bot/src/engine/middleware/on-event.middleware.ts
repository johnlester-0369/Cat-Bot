/**
 * onEvent Middleware — Event Handler Pre-dispatch Guards
 *
 * Runs once per handler invocation BEFORE the module's onEvent() executes.
 * ctx.mod is the specific module about to be called, enabling fine-grained
 * per-module guards without modifying module code or coupling modules to each other.
 *
 * ── enforceWarnBan ────────────────────────────────────────────────────────────
 * Suppresses the `join` module's welcome message when any rejoining member is
 * warn-banned (≥3 active warnings in the thread's warn collection).
 *
 * Both `join.ts` and `checkwarn.ts` subscribe to `log:subscribe`. Without this
 * guard, the bot would send "Welcome!" immediately before checkwarn.ts fires its
 * "You are banned and will be removed" notification — confusing UX. This middleware
 * lets checkwarn.ts own the interaction for banned members entirely.
 *
 * Fail-open policy: any DB error during the warn-list lookup falls through to
 * next() so a temporary outage never silently blocks legitimate welcome messages.
 *
 * Extension points: add additional event-level guards (rate limiting, platform
 * feature flags, per-module audit logging) via use.onEvent([yourMiddleware]) in
 * src/middleware/index.ts.
 */

import type {
  MiddlewareFn,
  OnEventCtx,
} from '@/engine/types/middleware.types.js';

/**
 * Suppresses the `join` event module for any log:subscribe batch where at least
 * one rejoining member has ≥3 active warnings in the thread's warn collection.
 *
 * Scope: only activates when ALL of the following are true:
 *   1. eventType === 'log:subscribe'
 *   2. The current module's config.name === 'join'
 *   3. At least one joining participant has ≥3 warn entries in the thread store
 *
 * checkwarn.ts is intentionally NOT blocked — it owns the kick and ban notification
 * for the same event. Allowing both would produce a "Welcome!" immediately before
 * the ban removal message, which contradicts the moderation action.
 */
export const enforceWarnBan: MiddlewareFn<OnEventCtx> = async function (
  ctx,
  next,
): Promise<void> {
  // Only gate on member-join events — all other event types pass through immediately
  if (ctx.eventType !== 'log:subscribe') {
    await next();
    return;
  }

  // Only suppress the join module — checkwarn.ts and any other log:subscribe handlers run freely
  const modName = (
    (ctx.mod['config'] as { name?: string } | undefined)?.name ?? ''
  ).toLowerCase();
  if (modName !== 'join') {
    await next();
    return;
  }

  const threadID = (ctx.event['threadID'] ?? '') as string;
  const logMessageData = ctx.event['logMessageData'] as
    | Record<string, unknown>
    | undefined;
  const added =
    (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ?? [];


  try {
    const coll = ctx.db.threads.collection(threadID);
    // If the warn collection has never been created, no bans can exist in this thread
    if (!(await coll.isCollectionExist('warn'))) {
      await next();
      return;
    }

    const warnColl = await coll.getCollection('warn');
    const warnList =
      ((await warnColl.get('list')) as Array<{
        uid: string;
        list: unknown[];
      }> | null) ?? [];

    // Suppress join.ts if any joining member is warn-banned (≥3 warns).
    // A partial batch (some banned, some clean) still suppresses the entire welcome —
    // checkwarn.ts handles the banned members, and the rare case of a mixed batch
    // missing a welcome for non-banned co-joiners is an acceptable UX trade-off.
    const anyWarnBanned = added.some((participant) => {
      const uid = String(participant['userFbId'] ?? '');
      if (!uid) return false;
      const entry = warnList.find((u) => u.uid === uid);
      return entry !== undefined && entry.list.length >= 3;
    });

    if (anyWarnBanned) {
      // Do NOT call next() — join.ts onEvent() never executes for this invocation.
      // checkwarn.ts runs on the same event in a separate chain invocation and handles
      // the notification and kick without interference from a welcome message.
      return;
    }
  } catch {
    // Fail-open: DB errors must never silently suppress legitimate welcome messages.
    // If the warn list is unreachable, the safe default is to let join.ts run.
  }

  await next();
};