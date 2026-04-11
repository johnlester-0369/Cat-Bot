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
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { isAuthError } from '@/engine/lib/retry.lib.js';

/**
 * Creates a Discord.js Client with all required intents and partials,
 * logs in with the given token, and waits for the ClientReady event.
 *
 * Process signal handlers (SIGINT/SIGTERM) are registered to gracefully
 * destroy the WebSocket connection before exit — prevents zombie connections
 * that would keep the bot "online" in Discord's eyes after Ctrl+C.
 */
export async function createDiscordClient(
  token: string,
  sessionLogger: SessionLogger,
  onFatalError?: (err: Error) => void,
): Promise<Client> {
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

  await new Promise<void>((resolve, reject) => {
    // Events.ClientReady avoids raw strings that could rename between discord.js versions
    client.once(Events.ClientReady, (c) => {
      sessionLogger.info(`[discord] Logged in as ${c.user.tag}`);
      resolve();
    });
    // Reject the bootstrap Promise on login failure so startSessionWithRetry can classify
    // the error: TokenInvalid → shouldRetry returns false → immediate fail (no retries).
    client.login(token).catch(reject);
  });

  // discord.js emits 'error' on WebSocket failures and unhandled REST errors.
  // Without this listener, Node.js treats an emitted 'error' with no handler as a
  // fatal exception that terminates the entire process — taking all other platforms down too.
  // discord.js manages gateway reconnection internally, so we only need to absorb the event.
  client.on('error', (err: Error) => {
    if (isAuthError(err)) {
      // Pass authentication drops up to the orchestrator to sync UI
      sessionLogger.error(
        '[discord] Session offline — token revoked or auth error mid-session',
        { error: err },
      );
      onFatalError?.(err);
    } else {
      sessionLogger.error(
        '[discord] Client error (gateway will auto-reconnect)',
        { error: err },
      );
    }
  });

  return client;
}
