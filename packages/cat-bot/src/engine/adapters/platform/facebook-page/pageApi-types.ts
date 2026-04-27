/**
 * Facebook Page — Graph API Interface Definitions
 *
 * Separated from pageApi.ts so that lib/* modules and wrapper.ts can import
 * the PageApi contract without pulling in HTTP implementation details.
 *
 * IMPORTANT: pageApi.ts re-exports these for backward compatibility —
 * lib/* modules import from '../pageApi.js' and must not break.
 */

export interface PageApi {
  getPageId(): Promise<string>;
  sendMessage(
    msg: string | Record<string, unknown>,
    threadID: string,
    callback?: (err: unknown, data: { messageID?: string } | null) => void,
  ): void;
  unsendMessage(messageID: string, callback?: (err: unknown) => void): void;
  getUserInfo(
    userIds: string[],
    callback: (
      err: unknown,
      users: Record<string, { name: string }> | null,
    ) => void,
  ): void;
  getMessage(messageID: string): Promise<GetMessageResult | null>;
  /** Sends an image/video/audio/file attachment via Graph API server-side URL fetch — no stream download needed. */
  sendUrlAttachment(
    url: string,
    threadID: string,
    filename?: string,
  ): Promise<string | undefined>;
  /** Retrieves the profile picture URL for a user given their PSID */
  getAvatarUrl(userID: string): Promise<string | null>;
}

export interface GetMessageResult {
  text: string | null;
  from: { id: string; name?: string } | null;
  createdTime: string | null;
  attachments: { data: unknown[] } | null;
  sticker: unknown | null;
}
