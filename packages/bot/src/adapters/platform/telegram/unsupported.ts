/**
 * Telegram — Unsupported Operation Stubs
 *
 * addUserToGroup: The Bot API has no direct addChatMember method — bots can
 * only create invite links or unban previously removed users. Throwing prompts
 * command authors to use the correct Telegram invite-link flow instead.
 *
 * setGroupReaction: Telegram does not expose a group-level default reaction
 * emoji setting via the Bot API as of 2026.
 */

export async function addUserToGroup(
  _threadID: string,
  _userID: string,
): Promise<never> {
  throw new Error(
    'addUserToGroup is not directly supported on Telegram — ' +
      'send the user an invite link via bot.telegram.createChatInviteLink() instead.',
  );
}

export async function setGroupReaction(
  _threadID: string,
  _emoji: string,
): Promise<never> {
  throw new Error('setGroupReaction is not supported on Telegram.');
}
