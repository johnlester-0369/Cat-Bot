import type { 
  ChatContext, 
  ThreadContext, 
  BotContext 
} from '@/engine/adapters/models/context.model.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/constants/command-option.constants.js';
import { Platforms } from '@/engine/constants/platform.constants.js';

export const config = {
  name: 'kick',
  aliases: ['remove'] as string[],
  version: '1.0.0',
  role: Role.THREAD_ADMIN, // Kicking requires thread moderation privileges
  author: 'System',
  description: 'Remove a user from the current group. Provide a user ID, mention them, or reply to their message.',
  category: 'Admin',
  usage: '[uid | @mention | reply]',
  cooldown: 5,
  hasPrefix: true,
  // Exclude Facebook Page since facebook page cannot add to group chat
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.FacebookMessenger],
  options: [
    {
      type: OptionType.user,
      name: 'user',
      description: 'User to kick',
      required: true,
    },
  ],
};

export const onCommand = async ({
  chat,
  thread,
  bot,
  event,
  args,
}: {
  chat: ChatContext;
  thread: ThreadContext;
  bot: BotContext;
  event: Record<string, unknown>;
  args: string[];
}): Promise<void> => {
  // 1. Guard: Ensure this is a group thread
  // Single-user DMs cannot have participants removed.
  if (!event['isGroup']) {
    await chat.replyMessage({ message: '❌ This command can only be used in group chats.' });
    return;
  }

  // 2. Resolve target ID gracefully (Priority: Reply > Mention > Argument)
  let targetID = (event['messageReply'] as Record<string, unknown> | undefined)?.['senderID'] as string | undefined;

  if (!targetID) {
    const mentions = event['mentions'] as Record<string, string>;
    const mentionIDs = Object.keys(mentions || {});
    if (mentionIDs.length > 0) {
      targetID = mentionIDs[0]; // Kick the first mentioned user
    }
  }

  if (!targetID && args.length > 0) {
    targetID = args[0];
  }

  if (!targetID) {
    await chat.replyMessage({
      message: '❌ Please provide a user ID, @mention the user, or reply to their message to kick them.',
    });
    return;
  }

  // 3. Guard: Prevent the bot from attempting to kick itself
  const botID = await bot.getID();
  if (targetID === botID) {
    await chat.replyMessage({ message: '❌ I cannot kick myself.' });
    return;
  }
  
  // Guard: Prevent the admin from accidentally kicking themselves
  const senderID = event['senderID'] as string | undefined;
  if (targetID === senderID) {
    await chat.replyMessage({ message: '❌ You cannot kick yourself using this command.' });
    return;
  }

  // 4. Execute removal via platform abstraction
  try {
    await thread.removeUser(targetID);
    await chat.replyMessage({ message: `✅ User ${targetID} has been removed from the group.` });
  } catch (err: unknown) {
    // Fails smoothly if the bot lacks native admin privileges on the platform
    await chat.replyMessage({ 
      message: `❌ Failed to remove user ${targetID}. Ensure I have admin privileges in this group.` 
    });
  }
};
