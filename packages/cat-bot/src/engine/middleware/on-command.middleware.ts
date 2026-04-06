/**
 * onCommand Middleware — Cooldown Enforcement + Options Parsing and Validation
 *
 * Extracts the guard block that previously lived in command.dispatcher.ts (lines 45–74).
 * Moving it here means:
 *   - command.dispatcher.ts is reduced to routing + chain invocation only
 *   - Additional command-level guards (auth, rate limiting, permission checks) can be
 *     inserted before or after this one via use.onCommand([...]) in index.ts
 *
 * Cooldown state has been further extracted to lib/cooldown.lib.ts so this file
 * owns only dispatch logic — zero mutable state lives here.
 *
 * Two parse paths (preserved from the original dispatcher):
 *   Discord slash ('/' prefix) → pre-resolved values in event.optionsRecord
 *                                 (set by event-handlers.ts to preserve Discord type coercion)
 *   All other platforms         → raw message body scanned with key: value regex
 *
 * Short-circuit: sends a user-facing usage error and returns WITHOUT calling next()
 * when any required option is absent — the onCommand handler never executes.
 * Options are mutated onto ctx so subsequent middleware and the final handler can read them.
 */

import type { MiddlewareFn, OnCommandCtx } from '@/engine/types/middleware.types.js';
import { OptionsMap } from '@/engine/lib/options-map.lib.js';
import type { OptionDef } from '@/engine/lib/options-map.lib.js';
import { parseTextOptions } from '@/engine/utils/options.util.js';
// Cooldown state delegated to lib/ — mirrors reply-state.lib.ts pattern;
// this middleware file stays free of mutable Map declarations.
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
// Repo functions for role checking — imported here so this middleware stays
// independently mockable in unit tests without spinning up a real DB connection.
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { Role } from '@/engine/constants/role.constants.js';

// ── Cooldown Enforcement ─────────────────────────────────────────────────────

/**
 * Enforces per-user command cooldowns declared in config.cooldown (seconds).
 *
 * First blocked attempt  → sends ONE "please wait N seconds" notice, latches notified flag.
 * Subsequent blocked attempts → silent no-op; no additional messages sent.
 * This hard cap of one notification per cooldown window prevents message flooding
 * when a user rapidly retries a command they have already been warned about.
 *
 * Registered BEFORE validateCommandOptions in the chain so option parsing is
 * skipped entirely for a command that will be rejected anyway.
 */
export const enforceCooldown: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const cfg = ctx.mod['config'] as Record<string, unknown> | undefined;
  const cooldownSec = cfg?.['cooldown'];

  // Commands that omit cooldown or set it to 0 skip this middleware entirely.
  if (typeof cooldownSec !== 'number' || cooldownSec <= 0) {
    await next();
    return;
  }

  // Scope per-user so two different users on the same command never block each other.
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    'unknown') as string;
  const key = `${ctx.parsed.name}:${senderID}`;
  const now = Date.now();

  // Lazy eviction delegated to the store — keeps this middleware free of Map management.
  cooldownStore.pruneIfNeeded(now);

  const entry = cooldownStore.check(key, now);
  if (entry !== null) {
    if (!entry.notified) {
      // First blocked attempt — send the notice exactly once and latch the flag.
      // All subsequent attempts within this window are silently dropped (no spam).
      cooldownStore.markNotified(key);
      const remainingSec = Math.ceil((entry.expiry - now) / 1000);
      await ctx.chat.replyMessage({
        message: `⏳ Please wait ${remainingSec} second${remainingSec !== 1 ? 's' : ''} before using this command again.`,
      });
    }
    // Do NOT call next() — command is blocked regardless of notification state.
    return;
  }

  // Cooldown expired or first invocation — register a fresh window before proceeding
  // so the window starts at invocation time, not after the handler finishes.
  cooldownStore.record(key, now, cooldownSec * 1000);
  await next();
};

// ── Options Parsing + Validation ─────────────────────────────────────────────

export const validateCommandOptions: MiddlewareFn<OnCommandCtx> =
  async function (ctx, next): Promise<void> {
    const cfg = ctx.mod['config'] as Record<string, unknown> | undefined;
    const optionDefs = (cfg?.['options'] as OptionDef[] | undefined) ?? [];

    if (optionDefs.length > 0) {
      // Discord slash commands embed pre-resolved values so interaction.options type
      // coercion and native validation are preserved. All other platforms re-parse the body.
      const preBuilt = ctx.event['optionsRecord'] as
        | Record<string, string>
        | undefined;

      const options =
        preBuilt !== undefined
          ? new OptionsMap(preBuilt)
          : new OptionsMap(
              parseTextOptions(
        (ctx.event['message'] ?? ctx.event['body'] ?? '') as string,
                optionDefs,
              ),
            );

      // Options are parsed and available on ctx.options — validation errors are intentionally
      // suppressed so command handlers receive options as-is and decide how to handle missing values.
      ctx.options = options;
    } else {
      // No options defined — set empty map so the handler always has ctx.options available.
      ctx.options = OptionsMap.empty();
    }


    await next();
  };

// ── Role Enforcement ──────────────────────────────────────────────────────────

/**
 * Enforces config.role declared on each command module.
 *
 * Role levels:
 *   Role.ANYONE (0)       — any user can invoke the command (public default)
 *   Role.THREAD_ADMIN (1) — only thread admins (bot_threads.admins relation) can invoke
 *   Role.BOT_ADMIN (2)    — only bot admins (BotAdmin table for this owner session) can invoke
 *
 * Registered BEFORE enforceCooldown in the chain so an unauthorised attempt is
 * rejected immediately without consuming the user's cooldown window or running
 * options parsing — both of which are wasted work on denied requests.
 *
 * Fail-safe on missing DB state: if the thread has not yet been synced when
 * Role.THREAD_ADMIN, isThreadAdmin returns false and the command is denied rather
 * than making a live platform API call from inside the guard.
 *
 * If sessionUserId or sessionId is absent from native context (rare during early
 * boot or in test harnesses that do not populate them), isBotAdmin receives empty
 * strings and returns false — the Role.BOT_ADMIN command is correctly denied.
 */
export const enforcePermission: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const cfg = ctx.mod['config'] as Record<string, unknown> | undefined;
  const role = cfg?.['role'];

  // Role.ANYONE (0) or absent: no privilege check needed, advance immediately
  if (typeof role !== 'number' || role === Role.ANYONE) {
    await next();
    return;
  }

  // Both IDs are required for any permission check; fall through if they are absent
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  if (role === Role.THREAD_ADMIN) {
    // Thread-admin gate: on-chat.middleware has already synced the thread before
    // any command dispatcher runs, so bot_threads should contain the admins list.
    const allowed = await isThreadAdmin(threadID, senderID);
    if (!allowed) {
      await ctx.chat.replyMessage({
        message: '🚫 This command is restricted to group admins.',
      });
      return; // Do NOT call next() — chain halts; handler never runs
    }
  } else if (role === Role.BOT_ADMIN) {
    // Bot-admin gate: BotAdmin rows are provisioned via the web dashboard by the
    // bot owner; senderID must match an adminId scoped to this exact owner session.
    const sessionUserId = ctx.native.userId ?? '';
    const sessionId = ctx.native.sessionId ?? '';
    const allowed = await isBotAdmin(sessionUserId, ctx.native.platform, sessionId, senderID);
    if (!allowed) {
      await ctx.chat.replyMessage({
        message: '🚫 This command is restricted to bot admins.',
      });
      return; // Do NOT call next() — chain halts; handler never runs
    }
  }

  // role > 2 or unrecognised: fall through and allow (forward-compatible default)
  await next();
};

