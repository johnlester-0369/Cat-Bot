/**
 * Discord Platform — Slash Command Registration
 *
 * Single responsibility: register and clear Discord application commands via REST.
 *
 * WHY: Slash command REST logic (~70 lines) was inlined in index.ts start()
 * alongside client bootstrapping and event handler wiring. Isolating it makes
 * the command registration decision (prefix-based toggle) visible in one place.
 *
 * Decision: prefix='/'  → register global commands so Discord's menu appears
 *           prefix≠'/'  → clear global commands so the menu stays empty and
 *                          users discover the text-prefix instead
 */

import { SlashCommandBuilder, REST, Routes } from 'discord.js';
import { logger } from '@/lib/logger.lib.js';
import type { Client } from 'discord.js';

// Shape of each option entry in a command module's config.options array
interface SlashOption {
  type: string;
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
}

/**
 * Builds the slash command JSON array from the loaded commands map.
 * Only commands exporting onCommand get a slash registration — onChat-only
 * commands (e.g. auto-responses) have no slash equivalent.
 */
function buildSlashCommandPayloads(
  commands: Map<string, Record<string, unknown>>,
): ReturnType<InstanceType<typeof SlashCommandBuilder>['toJSON']>[] {
  const payloads: ReturnType<
    InstanceType<typeof SlashCommandBuilder>['toJSON']
  >[] = [];

  for (const [, mod] of commands) {
    if (typeof mod['onCommand'] !== 'function') continue;
    const cfg = mod['config'] as Record<string, unknown>;
    const builder = new SlashCommandBuilder()
      .setName(cfg['name'] as string)
      .setDescription(cfg['description'] as string);

    for (const opt of (cfg['options'] as SlashOption[]) ?? []) {
      if (opt.type === 'string') {
        builder.addStringOption((o) =>
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
 * Registers or clears slash commands based on the active prefix.
 *
 * prefix='/'  → wipe per-guild commands (eliminate duplicates), then publish globally
 * prefix≠'/'  → wipe global commands so Discord's '/' menu stays clean
 */
export async function registerSlashCommands(
  options: SlashCommandOptions,
): Promise<void> {
  const { client, commands, prefix, clientId, token } = options;

  if (!clientId) {
    logger.warn(
      '[discord] ⚠️  CLIENT_ID not set — skipping slash command registration',
    );
    return;
  }

  const rest = new REST().setToken(token);

  if (prefix === '/') {
    const slashCommands = buildSlashCommandPayloads(commands);

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
        logger.info(
          `[discord] Cleared guild-scoped commands from ${guildIds.length} guild(s)`,
        );
      }
      // Step 2 — publish globally; single source of truth for all guilds and DMs
      await rest.put(Routes.applicationCommands(clientId), {
        body: slashCommands,
      });
      logger.info(
        `[discord] Deployed ${slashCommands.length} global command(s)`,
      );
    } catch (err) {
      logger.warn('[discord] Slash command registration failed (non-fatal)', {
        error: err,
      });
    }
  } else {
    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      logger.info(
        `[discord] Cleared global slash commands (prefix "${prefix}" ≠ "/"; slash menu disabled)`,
      );
    } catch (err) {
      logger.warn('[discord] Failed to clear global commands (non-fatal)', {
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
): Promise<void> {
  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: [],
    });
    logger.info(
      `[discord] Cleared guild-scoped commands in new guild: ${guildId}`,
    );
  } catch (err) {
    logger.warn(`[discord] Failed to clear commands in new guild ${guildId}`, {
      error: err,
    });
  }
}
