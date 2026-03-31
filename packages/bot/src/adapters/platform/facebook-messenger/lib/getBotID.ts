/**
 * Retrieves the logged-in Facebook user ID of the bot account.
 */

interface FcaApi {
  getCurrentUserID(cb: (err: unknown, id: string | number) => void): void;
}

export function getBotID(api: FcaApi): Promise<string> {
  return new Promise((resolve, reject) => {
    api.getCurrentUserID((err, id) =>
      err ? reject(err) : resolve(String(id)),
    );
  });
}
