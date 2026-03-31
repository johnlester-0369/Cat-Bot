/**
 * Discord — Unsupported Operation Stubs
 *
 * All operations that cannot be performed on Discord are grouped here to reduce
 * file clutter and provide a single location for unsupported method documentation.
 *
 * Discord Bot API limitations:
 *   - addUserToGroup: requires OAuth2 guilds.join scope — regular bot token cannot add users;
 *                     users must join via an invite link.
 *   - setGroupReaction: Discord guilds do not have a thread-level default emoji concept.
 *
 * Command modules that call these should catch the thrown error and surface a
 * user-friendly message rather than letting the rejection bubble to the handler.
 */

/**
 * Unsupported: Discord Bot API requires OAuth2 guilds.join scope to add users
 * to a guild — a regular bot token cannot do this; users must join via an invite link.
 */
export async function addUserToGroup(): Promise<never> {
  throw new Error(
    'addUserToGroup is not supported on Discord — users must join via an invite link.',
  );
}

/**
 * Unsupported: Discord guilds do not have a thread-level default emoji — no equivalent concept.
 */
export async function setGroupReaction(): Promise<never> {
  throw new Error('setGroupReaction is not supported on Discord.');
}
