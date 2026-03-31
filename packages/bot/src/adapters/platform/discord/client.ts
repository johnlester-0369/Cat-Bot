/**
 * Discord Platform — Client Factory
 *
 * Single responsibility: create, configure, and boot the Discord.js Client.
 * All gateway intent, partial message, login, and process-lifecycle concerns
 * are isolated here so the listener orchestrator never touches transport config.
 *
 * WHY: Extracted from index.ts — a 360-line monolith that mixed client
 * bootstrapping with slash command registration and event handler wiring.
 * Separating client lifecycle makes it testable and replaceable independently.
 */

import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { logger } from '@/lib/logger.lib.js';
import { shutdownRegistry } from '@/lib/shutdown.lib.js';

/**
 * Creates a Discord.js Client with all required intents and partials,
 * logs in with the given token, and waits for the ClientReady event.
 *
 * Process signal handlers (SIGINT/SIGTERM) are registered to gracefully
 * destroy the WebSocket connection before exit — prevents zombie connections
 * that would keep the bot "online" in Discord's eyes after Ctrl+C.
 */
export async function createDiscordClient(token: string): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    // Partials are required so reaction/delete events fire on uncached messages
    // sent before the bot last restarted — without them only cached messages trigger
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  await new Promise<void>((resolve) => {
    // Events.ClientReady avoids raw strings that could rename between discord.js versions
    client.once(Events.ClientReady, (c) => {
      logger.info(`[discord] Logged in as ${c.user.tag}`);
      resolve();
    });
    void client.login(token);
  });

  // destroy() registered with central shutdown registry — app.ts fires this on
  // SIGINT/SIGTERM so multiple Discord sessions never stack duplicate process.once listeners.
  shutdownRegistry.register(() => client.destroy());

  return client;
}
