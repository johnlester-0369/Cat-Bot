/**
 * Retracts a sent message via fca-unofficial unsendMessage.
 * fca resolves without returning meaningful data on success.
 */

interface FcaApi {
  unsendMessage(messageID: string, cb: () => void): void;
}

export function unsendMessage(api: FcaApi, messageID: string): Promise<void> {
  return new Promise((resolve) => {
    api.unsendMessage(messageID, () => resolve());
  });
}
