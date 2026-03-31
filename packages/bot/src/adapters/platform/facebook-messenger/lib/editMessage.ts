/**
 * Edits the body of a previously sent message via fca-unofficial.
 * Note the fca arg order: editMessage(body, messageID, cb) — body comes first,
 * which is the inverse of our unified API signature (messageID, newBody).
 */

interface FcaApi {
  editMessage(
    body: string,
    messageID: string,
    cb: (err: unknown) => void,
  ): void;
}

export function editMessage(
  api: FcaApi,
  messageID: string,
  newBody: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.editMessage(newBody, messageID, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
