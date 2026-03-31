/**
 * Adds a user to a group thread via fca-unofficial addUserToGroup.
 * Note fca arg order: addUserToGroup(userID, threadID, cb) — inverted from our (threadID, userID).
 */

/** Minimal fca-unofficial api surface used by this function. */
interface FcaApi {
  addUserToGroup(
    userID: string,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
}

export function addUserToGroup(
  api: FcaApi,
  threadID: string,
  userID: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.addUserToGroup(userID, threadID, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
