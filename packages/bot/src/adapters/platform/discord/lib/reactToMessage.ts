/**
 * Reacts to a Discord message with an emoji.
 * rawMessage is the triggering Message reference from the channel path —
 * when it matches messageID, we skip the REST fetch entirely (zero-fetch optimization).
 * The interaction path passes null for rawMessage since it has no pre-fetched message reference.
 */
import type { TextChannel, Message } from 'discord.js';

export async function reactToMessage(
  channel: TextChannel,
  messageID: string,
  emoji: string,
  rawMessage: Message | null = null,
): Promise<void> {
  if (!channel) throw new Error('Channel not available for reaction.');
  // Reuse the already-in-hand message reference to avoid a REST round-trip
  if (rawMessage?.id === messageID) {
    await rawMessage.react(emoji);
    return;
  }
  const msg = await channel.messages.fetch(messageID);
  await msg.react(emoji);
}
