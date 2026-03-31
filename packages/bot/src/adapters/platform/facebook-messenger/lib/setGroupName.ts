/**
 * Renames a group thread via fca-unofficial setTitle.
 * Guards against versions of fca-unofficial that omit setTitle to surface
 * the failure immediately rather than hanging silently.
 */

interface FcaApi {
  setTitle?: (
    name: string,
    threadID: string,
    cb: (err: unknown) => void,
  ) => void;
}

export function setGroupName(
  api: FcaApi,
  threadID: string,
  name: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof api.setTitle !== 'function') {
      reject(
        new Error(
          'Group rename is not supported in this version of fca-unofficial.',
        ),
      );
      return;
    }
    api.setTitle(name, threadID, (err) => (err ? reject(err) : resolve()));
  });
}
