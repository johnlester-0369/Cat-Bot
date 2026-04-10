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
import { sendTextMessage, sendTemplateMessage } from './pageApi-helpers.js';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { isAuthError } from '@/engine/lib/retry.lib.js';

// Re-export interfaces so lib/* imports from '../pageApi.js' remain valid
export type { PageApi, GetMessageResult } from './pageApi-types.js';

export function createPageApi(
  pageAccessToken: string,
  pageId: string,
  sessionLogger: SessionLogger,
  onAuthError?: (err: unknown) => void
): PageApi {
  const logError = (msg: string, extra?: Record<string, unknown>) => sessionLogger.error(msg, extra);

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
              // Attachment-only message with optional body caption — send caption first
              if (msgObj['body']) {
                await sendTextMessage(pageAccessToken, threadID, {
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
          logError('❌ sendMessage (page) failed', {
            error: axiosErr?.response?.data || axiosErr.message,
          });
          if (callback) callback(err, null);
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
        err: unknown,
        users: Record<string, { name: string }> | null,
      ) => void,
    ): void {
      // Graph API has no batch user endpoint — fetch sequentially.
      // Parallel requests risk hitting rate limits on large arrays.
      const fetchAll = async () => {
        try {
          const results: Record<string, { name: string }> = {};
          for (const uid of userIds) {
            const res = await axios.get<{ name: string }>(
              `${FB_API_BASE}/${uid}`,
              {
                params: { fields: 'name', access_token: pageAccessToken },
              },
            );
            results[uid] = { name: res.data.name };
          }
          callback(null, results);
        } catch (err) {
          callback(err, null);
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
  };
}
