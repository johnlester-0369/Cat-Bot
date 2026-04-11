/**
 * Retrieves the logged-in Facebook user ID of the bot account.
 */

interface FcaApi {
  getCurrentUserID(): string | number;
}

export function getBotID(api: FcaApi): Promise<string> {
  return new Promise((resolve) => {
    const botID = api.getCurrentUserID();
    resolve(String(botID));
  });
}
