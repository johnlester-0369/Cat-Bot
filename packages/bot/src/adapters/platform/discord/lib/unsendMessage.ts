/**
 * Deletes a message from a Discord text channel.
 * channel=null signals the interaction path where slash command replies cannot be
 * deleted via the interaction API — treating it as a no-op preserves original behaviour.
 */
import type { TextChannel } from 'discord.js';

export async function unsendMessage(
  channel: TextChannel | null,
  messageID: string,
): Promise<void> {
  if (!channel) return; // Slash command replies can't be deleted via interaction API
  try {
    const msg = await channel.messages.fetch(messageID);
    await msg.delete();
  } catch {
    // Permission errors and already-deleted messages are non-fatal
  }
}
