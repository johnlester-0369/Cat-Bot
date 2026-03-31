/**
 * Edits the body of a bot-sent Discord message.
 * Only the bot's own messages are editable — attempting to edit another user's
 * message will throw a DiscordAPIError with code 50005.
 */
import type { TextChannel } from 'discord.js';

export async function editMessage(
  channel: TextChannel,
  messageID: string,
  newBody: string,
): Promise<void> {
  if (!channel) throw new Error('Channel not available for editing.');
  // No direct channel.editMessage() in discord.js — must fetch the Message object first
  const msg = await channel.messages.fetch(messageID);
  await msg.edit(newBody);
}
