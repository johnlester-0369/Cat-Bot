/**
 * Sets a participant's display nickname in the thread via fca-unofficial changeNickname.
 * Empty string clears the nickname and restores the account's default name.
 * Note fca arg order: changeNickname(nickname, threadID, participantID, cb) — differs from our (threadID, userID) convention.
 */

interface FcaApi {
  changeNickname(
    nickname: string,
    threadID: string,
    participantID: string,
    cb: (err: unknown) => void,
  ): void;
}

export function setNickname(
  api: FcaApi,
  threadID: string,
  userID: string,
  nickname: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.changeNickname(nickname, threadID, userID, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
