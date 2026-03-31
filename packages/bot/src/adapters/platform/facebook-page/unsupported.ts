/**
 * Facebook Page — Unsupported Operation Stubs
 *
 * All operations that cannot be performed on Facebook Page Messenger are grouped
 * here because the throw-only pattern provides no isolation benefit when split
 * across individual files. FB Page conversations are always 1:1 so all group
 * management methods are permanently unavailable. The Graph API also lacks a
 * public message edit endpoint and a reaction endpoint for pages.
 *
 * Command modules that call these should catch the thrown error and surface a
 * user-friendly message rather than letting the rejection bubble to the handler.
 */

export async function editMessage(
  _messageID: string,
  _newBody: string,
): Promise<void> {
  throw new Error('editMessage is not supported on Facebook Pages.');
}

export async function setNickname(
  _threadID: string,
  _userID: string,
  _nickname: string,
): Promise<void> {
  // Page conversations are 1:1; no group participant nickname concept
  throw new Error('setNickname is not supported on Facebook Pages.');
}

export async function setGroupName(
  _threadID?: string,
  _name?: string,
): Promise<void> {
  // Page Messenger is always 1:1 — group name concept does not exist
  throw new Error(
    'setGroupName is not supported on Facebook Pages (always 1:1 conversations).',
  );
}

export async function setGroupImage(
  _threadID: string,
  _imageSource: unknown,
): Promise<void> {
  throw new Error('setGroupImage is not supported on Facebook Pages.');
}

export async function removeGroupImage(_threadID: string): Promise<void> {
  throw new Error('removeGroupImage is not supported on Facebook Pages.');
}

export async function addUserToGroup(
  _threadID: string,
  _userID: string,
): Promise<void> {
  throw new Error('addUserToGroup is not supported on Facebook Pages.');
}

export async function removeUserFromGroup(
  _threadID: string,
  _userID: string,
): Promise<void> {
  throw new Error('removeUserFromGroup is not supported on Facebook Pages.');
}

export async function setGroupReaction(
  _threadID: string,
  _emoji: string,
): Promise<void> {
  throw new Error('setGroupReaction is not supported on Facebook Pages.');
}

export async function reactToMessage(
  _threadID: string,
  _messageID: string,
  _emoji: string,
): Promise<void> {
  // The Facebook Page Messenger Send API does not expose a public message reaction endpoint
  throw new Error('reactToMessage is not supported on Facebook Pages.');
}
