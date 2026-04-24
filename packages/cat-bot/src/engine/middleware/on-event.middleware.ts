/**
 * onEvent Middleware — Event Handler Pre-dispatch Guards
 *
 * Runs once per handler invocation BEFORE the module's onEvent() executes.
 * ctx.mod is the specific module about to be called, enabling fine-grained
 * per-module guards without modifying module code or coupling modules to each other.
 *
 * ── enforceWarnBan ────────────────────────────────────────────────────────────
 * Suppresses both the `join` and `leave` modules when a member's removal is
 * driven by the warn-ban system (≥3 active warnings in the thread's warn collection).
 *
 * log:subscribe — `join.ts` and `checkwarn.ts` both subscribe to this event.
 * Without this guard the bot would send "Welcome!" immediately before checkwarn.ts
 * fires its "You are banned and will be removed" notification — confusing UX.
 *
 * log:unsubscribe — `leave.ts` fires a goodbye message for every removal.
 * When checkwarn.ts kicks a warn-banned member the same event fires, producing
 * an unwanted "👋 A member has been removed" alongside the ban notification.
 * This guard suppresses leave.ts for any departure where the member has ≥3 warns.
 *
 * NOTE: No wasRemoved check is applied on log:unsubscribe. Telegram and Discord
 * normalizers always emit author = '' (leave.ts documents this), making
 * wasRemoved permanently false on those platforms — the check would be a no-op
 * and leave.ts would fire regardless. Gating purely on warn count is the correct
 * approach: if a warn-banned member leaves for any reason, checkwarn.ts already
 * owns the moderation narrative and a goodbye message contradicts it.
 *
 * ── enforceCommandKick ────────────────────────────────────────────────────────
 * Suppresses leave.ts when a removal was explicitly triggered by the `kick`
 * command or the `badwords` passive scanner (second-offence auto-kick).
 *
 * Both commands send their own targeted removal notification:
 *   kick.ts     → "✅ <name> has been removed from the group."
 *   badwords.ts → "⚠️ Banned word detected. You have violated 2 times and will be kicked."
 *
 * Allowing leave.ts to also fire produces a contradictory "👋 A member has been
 * removed" alongside the command's own message. This guard suppresses it.
 *
 * The detection mechanism is a transient in-memory kick registry
 * (kick-registry.lib.ts). Each command writes the target uid to the registry
 * immediately before calling thread.removeUser(). The middleware then consumes
 * the entry on log:unsubscribe — a single-use check that prevents the entry
 * from accidentally suppressing future voluntary departures by the same user.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * enforceCommandKick runs first on log:unsubscribe because it is a cheaper
 * O(1) in-memory lookup that short-circuits immediately on a registry hit,
 * avoiding the DB round-trip that enforceWarnBan would perform. Both guards
 * share the same leave module target, so only one needs to succeed per event.
 *
 * ── Fail-open policy ─────────────────────────────────────────────────────────
 * Any DB error during the warn-list lookup falls through to next() so a
 * temporary outage never silently blocks legitimate messages.
 *
 * Extension points: add additional event-level guards (rate limiting, platform
 * feature flags, per-module audit logging) via use.onEvent([yourMiddleware]) in
 * src/middleware/index.ts.
 */

import type {
  MiddlewareFn,
  OnEventCtx,
} from '@/engine/types/middleware.types.js';
import { kickRegistry } from '@/engine/lib/kick-registry.lib.js';

// ── enforceWarnBan ────────────────────────────────────────────────────────────

/**
 * Suppresses the `join` and `leave` event modules when the relevant member(s)
 * are warn-banned (≥3 active warnings in the thread's warn collection).
 *
 * log:subscribe scope — activates when ALL of the following are true:
 *   1. eventType === 'log:subscribe'
 *   2. The current module's config.name === 'join'
 *   3. At least one joining participant has ≥3 warn entries in the thread store
 *
 * log:unsubscribe scope — activates when ALL of the following are true:
 *   1. eventType === 'log:unsubscribe'
 *   2. The current module's config.name === 'leave'
 *   3. The departing participant has ≥3 warn entries in the thread store
 *
 * checkwarn.ts is intentionally NOT blocked in either case — it owns the kick
 * and ban notification end-to-end. Allowing join.ts or leave.ts to fire alongside
 * it produces contradictory UX ("Welcome!" before a ban, or a goodbye after a kick).
 */
export const enforceWarnBan: MiddlewareFn<OnEventCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const modName = (
    (ctx.mod['config'] as { name?: string } | undefined)?.name ?? ''
  ).toLowerCase();

  // ── log:subscribe guard — suppress join.ts for warn-banned rejoining members ──
  if (ctx.eventType === 'log:subscribe') {
    // Only suppress the join module — checkwarn.ts and any other log:subscribe handlers run freely
    if (modName !== 'join') {
      await next();
      return;
    }

    const threadID = (ctx.event['threadID'] ?? '') as string;
    const logMessageData = ctx.event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const added =
      (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ??
      [];

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
    return;
  }

  // ── log:unsubscribe guard — suppress leave.ts for warn-banned departing members ──
  if (ctx.eventType === 'log:unsubscribe') {
    // Only suppress the leave module — all other log:unsubscribe handlers run freely
    if (modName !== 'leave') {
      await next();
      return;
    }

    const threadID = (ctx.event['threadID'] ?? '') as string;
    const logMessageData = ctx.event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const leftId = String(logMessageData?.['leftParticipantFbId'] ?? '');

    // No wasRemoved check here — Telegram/Discord normalizers always emit author = ''
    // making wasRemoved permanently false on those platforms (leave.ts documents this).
    // Gating purely on warn count is correct: if the departing member is warn-banned
    // (≥3 warns) the goodbye message is suppressed regardless of how they left,
    // because checkwarn.ts already owns the full moderation interaction for that member.
    if (!leftId) {
      await next();
      return;
    }

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
          list: unknown[]
        }> | null) ?? [];

      const entry = warnList.find((u) => u.uid === leftId);
      const isWarnBanned = entry !== undefined && entry.list.length >= 3;

      if (isWarnBanned) {
        // Do NOT call next() — leave.ts onEvent() never executes for this invocation.
        // checkwarn.ts already owns the full interaction for the ban; a simultaneous
        // "👋 A member has been removed" message directly contradicts the moderation flow.
        return;
      }
    } catch {
      // Fail-open: DB errors must never silently suppress legitimate goodbye messages.
      // If the warn list is unreachable, the safe default is to let leave.ts run.
    }

    await next();
    return;
  }

  // All other event types pass through without any warn-ban gating
  await next();
};

// ── enforceCommandKick ────────────────────────────────────────────────────────

/**
 * Suppresses leave.ts when the departing member was explicitly removed by the
 * `kick` command or the `badwords` auto-kick (second-offence enforcement).
 *
 * Both callers register the target uid in kickRegistry immediately before calling
 * thread.removeUser(). This middleware consumes the entry on log:unsubscribe —
 * the consume() call is destructive (single-use) so a later voluntary departure
 * by the same user in the same thread is never incorrectly suppressed.
 *
 * log:unsubscribe scope — activates when ALL of the following are true:
 *   1. eventType === 'log:unsubscribe'
 *   2. The current module's config.name === 'leave'
 *   3. leftParticipantFbId is present in the kick registry for this thread
 *
 * This guard is checked BEFORE enforceWarnBan's DB lookup on the same event,
 * making it the fast path for command-driven removals. If the registry misses
 * (uid not present), control falls through to enforceWarnBan unchanged.
 *
 * Intentionally NOT applied to log:subscribe — the kick and badwords commands
 * never add members to a group, so the join guard is unaffected.
 */
export const enforceCommandKick: MiddlewareFn<OnEventCtx> = async function (
  ctx,
  next,
): Promise<void> {
  // Only intercept log:unsubscribe events targeting the leave module
  if (ctx.eventType !== 'log:unsubscribe') {
    await next();
    return;
  }

  const modName = (
    (ctx.mod['config'] as { name?: string } | undefined)?.name ?? ''
  ).toLowerCase();

  if (modName !== 'leave') {
    await next();
    return;
  }

  const threadID = (ctx.event['threadID'] ?? '') as string;
  const logMessageData = ctx.event['logMessageData'] as
    | Record<string, unknown>
    | undefined;
  const leftId = String(logMessageData?.['leftParticipantFbId'] ?? '');

  if (!leftId) {
    await next();
    return;
  }

  // consume() returns true and clears the registry entry if this uid was registered
  // by kick.ts or badwords.ts. The entry is single-use — a future voluntary departure
  // by the same user will miss the registry and leave.ts will fire normally.
  if (kickRegistry.consume(threadID, leftId)) {
    // Do NOT call next() — leave.ts onEvent() never executes for this invocation.
    // The kick command or badwords already sent its own targeted removal notification;
    // a simultaneous "👋 A member has been removed" contradicts that message.
    return;
  }

  // Registry miss: this was a voluntary departure or a warn-ban kick.
  // Fall through so enforceWarnBan (registered after this middleware) can apply
  // its own DB-backed guard, or leave.ts runs normally if neither guard matches.
  await next();
};
