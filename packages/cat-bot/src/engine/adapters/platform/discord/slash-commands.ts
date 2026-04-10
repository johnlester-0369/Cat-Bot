/**
 * Discord Platform — Slash Command Registration
 *
 * Single responsibility: register and clear Discord application commands via REST.
 * Adds command-hash idempotency so the REST API is only called when the menu is
 * actually stale — avoiding rate-limit budget waste and latency on every restart.
 *
 * Decision: prefix='/'  → register global commands so Discord's menu appears
 *           prefix≠'/'  → clear global commands so the menu stays empty and
 *                          users discover the text-prefix instead
 *
 * Registration gate (evaluated against the DB credential row before each REST call):
 *   REGISTER when: prefix == '/' AND (!isCommandRegister OR hash ≠ storedHash)
 *   CLEAR    when: prefix != '/' AND (isCommandRegister OR commandHash IS NOT NULL)
 *   SKIP     otherwise — menu is already in the desired state
 */

import { SlashCommandBuilder, REST, Routes } from 'discord.js';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import type { Client } from 'discord.js';
import { computeCommandHash } from '@/engine/utils/command-hash.util.js';
import {
  findDiscordCredentialState,
  updateDiscordCredentialCommandHash,
} from '@/engine/repos/credentials.repo.js';
import { OptionType } from '@/engine/constants/command-option.constants.js';
import type { OptionTypeValue } from '@/engine/constants/command-option.constants.js';
import { isPlatformAllowed } from '@/engine/utils/platform-filter.util.js';
import { Platforms } from '@/engine/constants/platform.constants.js';

// Shape of each option entry in a command module's config.options array
interface SlashOption {
  type: OptionTypeValue;
  name: string;
  description: string;
  required?: boolean;
}

interface SlashCommandOptions {
  client: Client;
  commands: Map<string, Record<string, unknown>>;
  prefix: string;
  clientId: string;
  token: string;
  /** better-auth userId — part of the composite PK in bot_credential_discord */
  userId: string;
  /** Discord session identifier — part of the composite PK in bot_credential_discord */
  sessionId: string;
  sessionLogger: SessionLogger;
  /** Lowercase command names currently disabled for this session — excluded from Discord's '/' menu.
   *  Sourced from bot_session_commands at re-registration time so the menu stays consistent with the DB. */
  disabledNames?: Set<string>;
  /** Bypass the command-hash idempotency check and force a REST round-trip regardless of stored state.
   *  Set true when triggered by a dashboard toggle — the enabled-set changed, not the config hash. */
  forceRegister?: boolean;
}

/**
 * Builds the slash command JSON array from the loaded commands map.
 * Only commands exporting onCommand get a slash registration — onChat-only
 * commands (e.g. auto-responses) have no slash equivalent.
 */
function buildSlashCommandPayloads(
  commands: Map<string, Record<string, unknown>>,
  disabledNames?: Set<string>,
): ReturnType<InstanceType<typeof SlashCommandBuilder>['toJSON']>[] {
  const payloads: ReturnType<
    InstanceType<typeof SlashCommandBuilder>['toJSON']
  >[] = [];

  // Iterate using keys to properly register both canonical names and their aliases as separate slash commands
  for (const [key, mod] of commands) {
    if (typeof mod['onCommand'] !== 'function') continue;
    if (!isPlatformAllowed(mod, Platforms.Discord)) continue;

    const cfg = mod['config'] as {
      name: string;
      description: string;
      options?: SlashOption[];
    };

    // Exclude commands disabled by the bot admin
    if (disabledNames?.has(cfg.name.toLowerCase())) continue;

    const builder = new SlashCommandBuilder()
      .setName(key)
      .setDescription(cfg.description);

    for (const opt of cfg.options ?? []) {
      if (opt.type === OptionType.string) {
        builder.addStringOption((o) =>
          o
            .setName(opt.name)
            .setDescription(opt.description)
            .setRequired(opt.required ?? false),
        );
      } else if (opt.type === OptionType.user) {
        // addUserOption renders a native Discord guild-member picker in the '/' menu
        // instead of a free-text field — Discord resolves the selection to a User object
        // whose .id is extracted downstream in event-handlers.ts via getUser()
        builder.addUserOption((o) =>
          o
            .setName(opt.name)
            .setDescription(opt.description)
            .setRequired(opt.required ?? false),
        );
      }
    }

    payloads.push(builder.toJSON());
  }

  return payloads;
}

/**
 * Registers or clears slash commands based on the active prefix, skipping the
 * REST round-trip when the DB shows the menu is already in the desired state.
 *
 * prefix='/'  → wipe per-guild commands (eliminate duplicates), then publish globally
 * prefix≠'/'  → wipe global commands so Discord's '/' menu stays clean
 */
export async function registerSlashCommands(
  options: SlashCommandOptions,
): Promise<void> {
  const { client, commands, prefix, clientId, token, userId, sessionId, sessionLogger, disabledNames, forceRegister } = options;

  if (!clientId) {
    sessionLogger.warn(
      '[discord] ⚠️  CLIENT_ID not set — skipping slash command registration',
    );
    return;
  }

  // Fingerprint the current slash-eligible command configs so we can detect
  // whether anything has changed since the last registered deployment.
  const currentHash = computeCommandHash(commands);

  // Read the stored registration state for this specific session credential.
  // Returns null only when the credential row is absent — should not happen in
  // normal operation, but we handle it gracefully by treating it as "not registered".
  const credential = await findDiscordCredentialState(userId, sessionId);

  const rest = new REST().setToken(token);

  if (prefix === '/') {
    // Skip the REST call when already registered AND the command set is identical.
    // Hash mismatch means a command was added, removed, or reconfigured since last deploy.
    // forceRegister overrides the skip — a dashboard toggle changes the enabled-set without altering the hash.
    if (!forceRegister && credential?.isCommandRegister && credential?.commandHash === currentHash) {
      sessionLogger.info(
        '[discord] Slash commands up-to-date (hash match) — skipping registration',
      );
      return;
    }

    const slashCommands = buildSlashCommandPayloads(commands, disabledNames);

    try {
      // Step 1 — wipe per-guild commands to eliminate duplicate menus
      const guildIds = [...client.guilds.cache.keys()];
      if (guildIds.length > 0) {
        await Promise.all(
          guildIds.map((gid) =>
            rest.put(Routes.applicationGuildCommands(clientId, gid), {
              body: [],
            }),
          ),
        );
        sessionLogger.info(
          `[discord] Cleared guild-scoped commands from ${guildIds.length} guild(s)`,
        );
      }
      // Step 2 — publish globally; single source of truth for all guilds and DMs
      await rest.put(Routes.applicationCommands(clientId), {
        body: slashCommands,
      });
      sessionLogger.info(
        `[discord] Deployed ${slashCommands.length} global command(s)`,
      );

      // Persist registration state — next restart skips the REST call when nothing changed
      await updateDiscordCredentialCommandHash(userId, sessionId, {
        isCommandRegister: true,
        commandHash: currentHash,
      });
    } catch (err) {
      sessionLogger.warn('[discord] Slash command registration failed (non-fatal)', {
        error: err,
      });
    }
  } else {
    // Skip when already cleared AND the fingerprint matches — hash equality is the gate,
    // not a null check. Storing currentHash on clear means this guard fires correctly on
    // every subsequent restart without an unnecessary REST round-trip.
    // forceRegister overrides so a toggle re-confirms the cleared state even without a hash change.
    if (!forceRegister && !credential?.isCommandRegister && credential?.commandHash === currentHash) {
      sessionLogger.info(
        `[discord] Slash commands already cleared (hash match) — skipping`,
      );
      return;
    }

    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      sessionLogger.info(
        `[discord] Cleared global slash commands (prefix "${prefix}" ≠ "/"; slash menu disabled)`,
      );

      // Mark as cleared so the next restart does not repeat the REST call
      // Store currentHash (not null) so the skip guard above fires correctly next restart
      await updateDiscordCredentialCommandHash(userId, sessionId, {
        isCommandRegister: false,
        commandHash: currentHash,
      });
    } catch (err) {
      sessionLogger.warn('[discord] Failed to clear global commands (non-fatal)', {
        error: err,
      });
    }
  }
}

/**
 * Clears guild-scoped commands in a newly joined guild.
 * Called on guildCreate to prevent visible duplicates with the global registration
 * — global commands are already present in new guilds immediately via the global PUT.
 */
export async function clearGuildCommands(
  guildId: string,
  clientId: string,
  token: string,
  sessionLogger: SessionLogger,
): Promise<void> {
  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: [],
    });
    sessionLogger.info(
      `[discord] Cleared guild-scoped commands in new guild: ${guildId}`,
    );
  } catch (err) {
    sessionLogger.warn(`[discord] Failed to clear commands in new guild ${guildId}`, {
      error: err,
    });
  }
}
