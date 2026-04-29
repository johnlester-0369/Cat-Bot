/**
 * Facebook Page Messenger API — Factory
 *
 * Creates the PageApi object that wraps Facebook Graph API HTTP calls in a
 * callback-style interface matching the fca-unofficial api shape. State
 * management (page ID caching) lives here; HTTP transport details are
 * delegated to pageApi-helpers.ts; type definitions live in pageApi-types.ts.
 *
 * Re-exports PageApi and GetMessageResult interfaces for backward compatibility:
 * lib/* modules import from '../pageApi.js' and must not break when internals
 * are moved to separate files.
 */

import axios from 'axios';
import type { PageApi, GetMessageResult } from './pageApi-types.js';
import { FB_API_BASE } from './pageApi-helpers.js';
import {
  sendTextMessage,
  sendTemplateMessage,
  sendAttachmentMessage,
  sendUrlAttachment as httpSendUrlAttachment,
  getAttachmentTypeFromExt,
} from './pageApi-helpers.js';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { isAuthError } from '@/engine/lib/retry.lib.js';

// Re-export interfaces so lib/* imports from '../pageApi.js' remain valid
export type { PageApi, GetMessageResult } from './pageApi-types.js';

export function createPageApi(
  pageAccessToken: string,
  pageId: string,
  sessionLogger: SessionLogger,
  onAuthError?: (err: unknown) => void,
): PageApi {
  const logError = (msg: string, extra?: Record<string, unknown>) =>
    sessionLogger.error(msg, extra);

  // Page ID is provided at construction time from credential.json (FB_PAGE_ID), eliminating
  // the GET /me call that requires the pages_read_engagement permission or app review.
  async function getPageId(): Promise<string> {
    return pageId;
  }

  return {
    getPageId,

    sendMessage(
      msg: string | Record<string, unknown>,
      threadID: string,
      callback?: (err: unknown, data: { messageID?: string } | null) => void,
    ): void {
      // Fire-and-forget wrapper matching fca-unofficial's callback pattern.
      // Errors are logged but never thrown to the caller — same contract as fca's api.sendMessage.
      const doSend = async () => {
        try {
          let result: { message_id?: string } | undefined;
          const isObj = msg !== null && typeof msg === 'object';

          if (isObj) {
            const msgObj = msg as Record<string, unknown>;
            if (msgObj['attachment'] && !msgObj['template']) {
              // Send attachment first so visual media appears above the text caption
              const stream = msgObj[
                'attachment'
              ] as import('stream').Readable & {
                path?: string;
              };
              result = await sendAttachmentMessage(
                pageAccessToken,
                threadID,
                stream,
              );

              // Send caption after attachment
              if (msgObj['body']) {
                result = await sendTextMessage(pageAccessToken, threadID, {
                  text: msgObj['body'],
                });
              }
            } else if (msgObj['template']) {
              // Button Template path — msg.template is the payload object built by lib/replyMessage.ts
              result = await sendTemplateMessage(
                pageAccessToken,
                threadID,
                msgObj['template'] as Record<string, unknown>,
              );
            } else if (msgObj['body']) {
              result = await sendTextMessage(pageAccessToken, threadID, {
                text: msgObj['body'],
              });
            }
          } else if (typeof msg === 'string') {
            result = await sendTextMessage(pageAccessToken, threadID, {
              text: msg,
            });
          }

          if (callback)
            callback(
              null,
              result?.message_id ? { messageID: result.message_id } : {},
            );
        } catch (err) {
          const axiosErr = err as {
            response?: { data: unknown };
            message?: string;
          };
          // Identify permission/revocation errors and trigger shutdown handler
          if (isAuthError(err)) {
            onAuthError?.(err);
          }

          // Log the error without throwing — fca-unofficial compat
          logError('sendMessage ❌', {
            error: axiosErr.response?.data || axiosErr.message,
          });

          // Callback with error to match fca-unofficial's error handling pattern
          if (callback) {
            callback(err, null);
          }
        }
      };
      doSend();
    },

    unsendMessage(messageID: string, callback?: (err: unknown) => void): void {
      // Page API requires special DELETE permissions not available to most page tokens
      void messageID;
      if (typeof callback === 'function') callback(null);
    },

    getUserInfo(
      userIds: string[],
      callback: (
        err: null,
        users: Record<string, { name: string }> | null,
      ) => void,
    ): void {
      // WHY conversations endpoint: GET /{PSID}?fields=name targets the User node
      // directly and fails with GraphMethodException error_subcode 33 — it requires
      // "Business Asset User Profile Access" (App Review). The documented Messenger
      // Platform approach for reading a sender's name is:
      //   GET /{page-id}/conversations?user_id={PSID}&fields=participants
      // which only requires pages_messaging + pages_read_engagement — same permissions
      // already needed for the bot to receive and send messages.
      const fetchAll = async () => {
        try {
          const results: Record<string, { name: string }> = {};
          for (const uid of userIds) {
            try {
              const res = await axios.get<{
                data: Array<{
                  participants?: {
                    data?: Array<{ id: string; name?: string }>;
                  };
                }>;
              }>(`${FB_API_BASE}/${pageId}/conversations`, {
                params: {
                  user_id: uid,
                  fields: 'participants',
                  access_token: pageAccessToken,
                },
              });
              // Participants includes both the Page and the user — match by PSID
              // to extract the human sender's display name specifically
              const conv = res.data.data[0];
              const participant = conv?.participants?.data?.find(
                (p) => p.id === uid,
              );
              results[uid] = { name: participant?.name ?? `User ${uid}` };
            } catch (uidErr) {
              const typedErr = uidErr as {
                response?: { data?: unknown };
                message?: string;
              };
              logError(`[facebook-page] getUserInfo failed for ${uid}`, {
                error: typedErr?.response?.data ?? typedErr?.message,
              });
              results[uid] = { name: `User ${uid}` };
            }
          }
          callback(null, results);
        } catch (err) {
          const typedErr = err as {
            response?: { data?: unknown };
            message?: string;
          };
          logError('[facebook-page] getUserInfo outer failure', {
            error: typedErr?.response?.data ?? typedErr?.message,
          });
          callback(null, {});
        }
      };
      fetchAll();
    },

    async getMessage(messageID: string): Promise<GetMessageResult | null> {
      try {
        const res = await axios.get<{
          message?: string;
          from?: { id: string; name?: string };
          created_time?: string;
          attachments?: { data: unknown[] };
          sticker?: unknown;
        }>(`${FB_API_BASE}/${messageID}`, {
          params: {
            fields: 'message,from,created_time,attachments,sticker',
            access_token: pageAccessToken,
          },
        });
        return {
          text: res.data.message ?? null,
          from: res.data.from ?? null,
          createdTime: res.data.created_time ?? null,
          attachments: res.data.attachments ?? { data: [] },
          sticker: res.data.sticker ?? null,
        };
      } catch (err) {
        const axiosErr = err as {
          response?: { data: unknown };
          message?: string;
        };
        // Handled passively on incoming fetch instead of active listener
        if (isAuthError(err)) {
          onAuthError?.(err);
        }
        logError('❌ getMessage (page) failed', {
          error: axiosErr?.response?.data || axiosErr.message,
        });
        return null;
      }
    },

    async sendUrlAttachment(
      url: string,
      threadID: string,
      filename = '',
    ): Promise<string | undefined> {
      // Derive the Graph API type from the filename extension so the correct
      // attachment category is declared (image/video/audio/file).
      const type = getAttachmentTypeFromExt(filename || url);
      try {
        const r = await httpSendUrlAttachment(
          pageAccessToken,
          threadID,
          url,
          type,
        );
        return r.message_id;
      } catch (err) {
        const axiosErr = err as {
          response?: { data: unknown };
          message?: string;
        };
        if (isAuthError(err)) onAuthError?.(err);
        logError('❌ sendUrlAttachment (page) failed', {
          error: axiosErr?.response?.data || axiosErr.message,
        });
        throw err;
      }
    },

    async getAvatarUrl(userID: string): Promise<string | null> {
      try {
        // WHY /picture edge: The ?fields=profile_pic User Profile API endpoint
        // requires "Business Asset User Profile Access" (App Review) per official
        // Meta documentation — most standard Page bots are never approved for it.
        // The /picture edge (Graph API v25.0) requires only a Page access token for
        // PSIDs — no App Review needed. redirect=0 (integer, not boolean false) forces
        // a JSON response instead of the default 302 redirect to the CDN binary.
        // Axios serialises JS `false` as the string "false" in query params, which the
        // Graph API may treat as truthy and still return a 302 — so the param is
        // embedded directly in the URL path as redirect=0 to guarantee correct behaviour.
        // Response shape: { data: { url, is_silhouette, width, height } }
        const res = await axios.get<{
          data?: { url?: string; is_silhouette?: boolean };
        }>(`${FB_API_BASE}/${userID}/picture?redirect=0`, {
          params: {
            type: 'large',
            access_token: pageAccessToken,
          },
        });
        // is_silhouette = true: user has no profile picture; return null so callers
        // can render a generic placeholder rather than the FB grey silhouette CDN image
        if (res.data.data?.is_silhouette) return null;
        return res.data.data?.url ?? null;
      } catch (err) {
        const axiosErr = err as {
          response?: { data?: { error?: { code?: number; message?: string } } };
          message?: string;
        };
        if (isAuthError(err)) onAuthError?.(err);
        // FB error 2018218: Messenger account created with a phone number — the Graph
        // API User Profile endpoint explicitly does not support these accounts. This is
        // a permanent platform limitation, not a transient failure; log distinctly so
        // developers do not spend time debugging a mis-configured credential.
        const fbCode = axiosErr.response?.data?.error?.code;
        if (fbCode === 2018218) {
          logError(
            `[facebook-page] getAvatarUrl: phone-number Messenger account — profile picture unavailable (FB error 2018218)`,
            { userID },
          );
          return null;
        }
        logError('❌ getAvatarUrl (page) failed', {
          error: axiosErr.response?.data || axiosErr.message,
        });
        return null;
      }
    },
  };
}
