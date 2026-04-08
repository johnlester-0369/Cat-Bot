/**
 * Telegram — Slash Command Menu Registration
 *
 * Manages the Telegram Bot API command menu across all four broadcast-level
 * scopes. Adds command-hash idempotency so Bot API calls are only issued when
 * the menu is actually stale — avoiding redundant network round-trips on restarts.
 *
 * Telegram uses a 7-scope priority chain; we manage the four broadcast scopes
 * (default, all_private_chats, all_group_chats, all_chat_administrators)
 * to prevent stale entries from shadowing the default scope as fallbacks.
 *
 * Registration gate (evaluated against the DB credential row before each Bot API call):
 *   REGISTER when: prefix == '/' AND (!isCommandRegister OR hash ≠ storedHash)
 *   CLEAR    when: prefix != '/' AND (isCommandRegister OR commandHash IS NOT NULL)
 *   SKIP     otherwise — menu is already in the desired state
 */
import type { Telegraf } from 'telegraf';
import type { SessionLogger } from '@/engine/lib/logger.lib.js';
import { computeCommandHash } from '@/engine/utils/command-hash.util.js';
import {
  findTelegramCredentialState,
  updateTelegramCredentialCommandHash,
} from '@/engine/repos/credentials.repo.js';
import { isPlatformAllowed } from '@/engine/utils/platform-filter.util.js';
import { Platforms } from '@/engine/constants/platform.constants.js';

/** All four broadcast scopes that must be managed in lockstep to avoid stale menu entries. */
const BROADCAST_SCOPES = [
  { type: 'default' as const },
  { type: 'all_private_chats' as const },
  { type: 'all_group_chats' as const },
  { type: 'all_chat_administrators' as const },
] as const;

/**
 * Telegram command names must match [a-z0-9_]{1,32} — the Bot API silently rejects or
 * errors on names containing hyphens. Normalise here so config.name values like
 * "example-buttons" become "example_buttons" without requiring every module to be renamed.
 */
function sanitizeTelegramCommandName(name: string): string {
  return name.replace(/-/g, '_').toLowerCase();
}

/**
 * Telegram's setMyCommands API rejects descriptions that contain emoji codepoints.
 * Strip all Extended_Pictographic characters (covers full emoji range in Unicode 15+)
 * then collapse any double-spaces left behind.
 */
function sanitizeTelegramDescription(desc: string): string {
  return desc.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Registers or clears the slash command menu across all Telegram broadcast scopes,
 * skipping the Bot API call when the DB shows the menu is already in the desired state.
 *
 * When prefix is '/', commands exporting both config.name and config.description
 * are registered; otherwise all scopes are cleared to prevent stale menu entries
 * from persisting when the bot uses a non-slash prefix.
 */
export async function registerSlashMenu(
  bot: Telegraf,
  commands: Map<string, Record<string, unknown>>,
  prefix: string,
  userId: string,
  sessionId: string,
  sessionLogger: SessionLogger,
  /** Lowercase command names currently disabled for this session — excluded from Telegram's command menu. */
  disabledNames?: Set<string>,
  /** Bypass the command-hash idempotency check; forces a Bot API call regardless of stored state. */
  forceRegister?: boolean,
): Promise<void> {
  // Fingerprint the current slash-eligible command configs so we can detect
  // whether anything has changed since the last registered deployment.
  const currentHash = computeCommandHash(commands);

  // Read the stored registration state for this specific session credential.
  // Returns null only when the credential row is absent — treated as "not registered".
  const credential = await findTelegramCredentialState(userId, sessionId);

  if (prefix === '/') {
    // Skip the Bot API call when already registered AND the command set is identical.
    // Hash mismatch means a command was added, removed, or reconfigured since last deploy.
    // forceRegister overrides the skip — a dashboard toggle changes the enabled-set without altering the hash.
    if (!forceRegister && credential?.isCommandRegister && credential?.commandHash === currentHash) {
      sessionLogger.info(
        '[telegram] Slash commands up-to-date (hash match) — skipping registration',
      );
      return;
    }

    const slashCommands: Array<{ command: string; description: string }> = [];
    // Iterate using keys to properly register both canonical names and their aliases as separate slash commands
    for (const [key, mod] of commands) {
      if (typeof mod['onCommand'] !== 'function') continue;
      if (!isPlatformAllowed(mod, Platforms.Telegram)) continue;
      const cfg = mod['config'] as
        | { name?: string; description?: string }
        | undefined;
      if (!cfg?.name || !cfg?.description) continue;
      // Exclude commands disabled by the bot admin — they must not appear in Telegram's command menu
      if (disabledNames?.has(cfg.name.toLowerCase())) continue;

      const rawName = key;
      const rawDesc = cfg.description;
      const safeName = sanitizeTelegramCommandName(rawName);
      const safeDesc = sanitizeTelegramDescription(rawDesc);
      // Warn so module authors know their config.name or description was mutated before
      // being sent to the Bot API — they can fix the source module at their discretion.
      if (safeName !== rawName) {
        sessionLogger.warn(
          `[telegram] Command name "${rawName}" contains hyphens — sanitized to "${safeName}" for Telegram`,
        );
      }
      if (safeDesc !== rawDesc) {
        sessionLogger.warn(
          `[telegram] Command "${safeName}" description contains emoji — stripped for Telegram`,
        );
      }
      slashCommands.push({ command: safeName, description: safeDesc });
    }

    try {
      await Promise.all(
        BROADCAST_SCOPES.map((scope) =>
          bot.telegram.setMyCommands(slashCommands, { scope }),
        ),
      );
      sessionLogger.info(
        `[telegram] Registered ${slashCommands.length} command(s) across all Telegram scopes`,
      );

      // Persist registration state — next restart skips the Bot API call when nothing changed
      await updateTelegramCredentialCommandHash(userId, sessionId, {
        isCommandRegister: true,
        commandHash: currentHash,
      });
    } catch (err) {
      sessionLogger.warn('[telegram] setMyCommands failed (non-fatal)', {
        error: err,
      });
    }
  } else {
    // Skip when already cleared AND the fingerprint matches — hash equality is the gate,
    // not a null check. Storing currentHash on clear means this guard fires correctly on
    // every subsequent restart without an unnecessary Bot API round-trip.
    // forceRegister overrides so a toggle re-confirms the cleared state even without a hash change.
    if (!forceRegister && !credential?.isCommandRegister && credential?.commandHash === currentHash) {
      sessionLogger.info(
        `[telegram] Slash commands already cleared (hash match) — skipping`,
      );
      return;
    }

    // setMyCommands([]) marks a scope as "empty-list", shadowing lower-priority fallbacks.
    // We must clear all four broadcast scopes or previously-registered entries remain visible.
    try {
      await Promise.all(
        BROADCAST_SCOPES.map((scope) =>
          bot.telegram.setMyCommands([], { scope }),
        ),
      );
      sessionLogger.info(
        `[telegram] Cleared Telegram command menu (prefix "${prefix}" ≠ "/"; slash menu disabled)`,
      );

      // Mark as cleared so the next restart does not repeat the Bot API call
      // Store currentHash (not null) so the skip guard above fires correctly next restart
      await updateTelegramCredentialCommandHash(userId, sessionId, {
        isCommandRegister: false,
        commandHash: currentHash,
      });
    } catch (err) {
      sessionLogger.warn(
        '[telegram] Failed to clear Telegram command menu (non-fatal)',
        { error: err },
      );
    }
  }
}
