/**
 * Reacts to a message via fca setMessageReaction.
 * Descriptor format { messageID, threadID } lets fca route via MQTT when connected
 * rather than falling back to a slower REST call.
 */

interface FcaApi {
  setMessageReaction(
    emoji: string,
    descriptor: { messageID: string; threadID: string },
    cb: (err: unknown) => void,
    force: boolean,
  ): void;
}

export function reactToMessage(
  api: FcaApi,
  threadID: string,
  messageID: string,
  emoji: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.setMessageReaction(
      emoji,
      { messageID, threadID },
      (err) => (err ? reject(err) : resolve()),
      true,
    );
  });
}
