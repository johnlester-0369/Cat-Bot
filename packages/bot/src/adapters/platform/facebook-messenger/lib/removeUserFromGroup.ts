/**
 * Removes a user from a group thread via fca-unofficial removeUserFromGroup.
 * Note fca arg order: removeUserFromGroup(userID, threadID, cb) — inverted from our convention.
 */

interface FcaApi {
  removeUserFromGroup(
    userID: string,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
}

export function removeUserFromGroup(
  api: FcaApi,
  threadID: string,
  userID: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.removeUserFromGroup(userID, threadID, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
