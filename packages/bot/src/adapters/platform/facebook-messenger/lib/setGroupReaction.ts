/**
 * Sets the group's quick-reaction (default "like") emoji via fca changeThreadEmoji.
 */

interface FcaApi {
  changeThreadEmoji(
    emoji: string,
    threadID: string,
    cb: (err: unknown) => void,
  ): void;
}

export function setGroupReaction(
  api: FcaApi,
  threadID: string,
  emoji: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.changeThreadEmoji(emoji, threadID, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
