/**
 * Facebook Page — replyMessage
 *
 * The Graph API has no batch send endpoint and no reply-threading concept —
 * each attachment goes out as a separate POST /me/messages call.
 * Text caption is sent first (if present) so the recipient reads context
 * before seeing the attachment stream(s).
 *
 * URL-based attachments are sent via the Graph API's server-side URL fetch
 * (attachment.payload.url) rather than downloading them first and re-uploading
 * as a stream. This eliminates the proxy download round-trip, reduces latency,
 * and avoids the broken stream path that was silently discarding images.
 *
 * Stream/buffer attachments (attachment[]) still use multipart form-data upload
 * via pageApi.sendMessage({ body, attachment: stream }) → sendAttachmentMessage().
 */

import { bufferToStream } from '@/engine/utils/streams.util.js';
import type { PageApi } from '@/engine/adapters/platform/facebook-page/pageApi.js';
import type { Readable } from 'stream';
// FB Page Graph API has no markdown support; mdToText converts to styled Unicode characters
import { mdToText } from '@/engine/utils/md-to-text.util.js';

import type { ReplyMessageOptions } from '@/engine/adapters/models/api.model.js';

/**
 * Note: the `mentions` parameter is accepted but silently ignored — the Facebook Page API
 * has no endpoint for tagging users in Page Messenger conversations.
 */
export async function replyMessage(
  pageApi: PageApi,
  threadID: string,
  options: ReplyMessageOptions = {},
): Promise<string | undefined> {
  const message = typeof options.message === 'string' ? options.message : '';
  const attachment = options.attachment ?? [];
  const attachment_url = options.attachment_url ?? [];
  const button = options.button ?? [];
  // Convert markdown to styled Unicode when requested — the FB Page API has no parse_mode equivalent
  const finalMessage =
    options.style === 'markdown' ? mdToText(message) : message;

  // Normalize stream/buffer attachments into Readable streams for multipart upload.
  // URL-based attachments (attachment_url) are handled separately via Graph API server-side fetch —
  // no need to download them locally and re-upload.
  const attachStreams: Array<Readable & { path?: string }> = attachment.map(
    ({ name, stream }) => {
      if (Buffer.isBuffer(stream)) return bufferToStream(stream, name);
      const s = stream as Readable & { path?: string };
      s.path = name;
      return s;
    },
  );

  // Facebook Button Template: pairs a required non-empty text with up to 3 postback buttons.
  // Attachments are intentionally sent BEFORE the template — Facebook renders messages in
  // insertion order, so leading with the image (e.g. the meme from meme.ts) places the
  // visual content above the caption+button row in the chat thread as the user sees it.
  // API reference: developers.facebook.com/docs/messenger-platform/send-messages/template/button
  if (button.length > 0) {
    // Flatten 2D array of rows into a 1D array to extract ButtonItem properties
    const fbButtons = button.flat().slice(0, 3).map((btn) => ({
      type: 'postback',
      // Facebook limits button titles to 20 characters — silently truncate to avoid API errors
      title: btn.label.slice(0, 20),
      payload: btn.id,
    }));
    // Send URL attachments first — image appears above the button template row in chat
    for (const { url, name } of attachment_url) {
      await pageApi.sendUrlAttachment(url, threadID, name);
    }
    // Send stream/buffer attachments before the template for the same visual ordering reason
    for (const stream of attachStreams) {
      await new Promise<void>((resolve, reject) => {
        pageApi.sendMessage(
          { body: '', attachment: stream },
          threadID,
          (err) => (err ? reject(err) : resolve()),
        );
      });
    }
    // Button template sent last — text caption and postback buttons follow the attachment visually
    const templateId = await new Promise<string | undefined>(
      (resolve, reject) => {
        pageApi.sendMessage(
          {
            template: {
              template_type: 'button',
              // FB requires non-empty text (1–640 chars) on button templates
              text: finalMessage || 'Choose an option:',
              buttons: fbButtons,
            },
          },
          threadID,
          (err, data) => (err ? reject(err) : resolve(data?.messageID)),
        );
      },
    );
    return templateId;
  }

  const hasAttachments = attachStreams.length > 0 || attachment_url.length > 0;

  if (!hasAttachments) {
    return new Promise<string | undefined>((resolve, reject) => {
      pageApi.sendMessage(finalMessage || '', threadID, (err, data) =>
        err ? reject(err) : resolve(data?.messageID),
      );
    });
  }

  // Send text caption first, then each attachment as a separate Graph API call
  if (message) {
    await new Promise<void>((resolve, reject) => {
      pageApi.sendMessage(finalMessage, threadID, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  let lastId: string | undefined;

  // Stream/buffer attachments: multipart form-data upload via pageApi.sendMessage
  for (const stream of attachStreams) {
    lastId = await new Promise<string | undefined>((resolve, reject) => {
      pageApi.sendMessage(
        { body: '', attachment: stream },
        threadID,
        (err, data) => (err ? reject(err) : resolve(data?.messageID)),
      );
    });
  }

  // URL attachments: Graph API fetches the asset server-side — no local download needed
  for (const { url, name } of attachment_url) {
    lastId = await pageApi.sendUrlAttachment(url, threadID, name);
  }

  return lastId;
}
