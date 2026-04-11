/**
 * Facebook Page — replyMessage
 *
 * The Graph API has no batch send endpoint and no reply-threading concept —
 * each attachment goes out as a separate POST /me/messages call.
 * Text caption is sent first (if present) so the recipient reads context
 * before seeing the attachment stream(s).
 */

// Fix pre-existing bug: urlToStream and bufferToStream were used without being imported,
// causing a ReferenceError at runtime whenever attachment_url or Buffer attachments were sent.
import { urlToStream, bufferToStream } from '@/engine/utils/streams.util.js';
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

  // Pass explicit name to urlToStream so pageApi's getAttachmentType() sees the caller-specified extension
  const urlStreams = await Promise.all(
    (attachment_url ?? []).map(({ name, url }) => urlToStream(url, name)),
  );
  // Normalize each attachment: Buffer inputs are wrapped into a named PassThrough stream so
  // sendAttachmentMessage's getAttachmentType() reads the correct MIME from the .path extension
  const attachStreams: Array<Readable & { path?: string }> = (
    attachment ?? []
  ).map(({ name, stream }) => {
    if (Buffer.isBuffer(stream)) return bufferToStream(stream, name);
    const s = stream as Readable & { path?: string };
    s.path = name;
    return s;
  });
  const allAttachments = [...attachStreams, ...urlStreams];

  // Facebook Button Template: pairs a required non-empty text with up to 3 postback buttons.
  // We handle this BEFORE the plain-text path so the template is sent first when buttons
  // are present; any attachments follow as sequential Graph API calls.
  // API reference: developers.facebook.com/docs/messenger-platform/send-messages/template/button
  if (button.length > 0) {
    const fbButtons = button.slice(0, 3).map((btn) => ({
      type: 'postback',
      // Facebook limits button titles to 20 characters — silently truncate to avoid API errors
      title: btn.label.slice(0, 20),
      payload: btn.id,
    }));
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
    // Send any remaining attachments as follow-up messages after the button template
    for (const stream of allAttachments) {
      await new Promise<void>((resolve, reject) => {
        pageApi.sendMessage(
          { body: '', attachment: stream },
          threadID,
          (err) => (err ? reject(err) : resolve()),
        );
      });
    }
    return templateId;
  }

  if (allAttachments.length === 0) {
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
  for (const stream of allAttachments) {
    lastId = await new Promise<string | undefined>((resolve, reject) => {
      pageApi.sendMessage(
        { body: '', attachment: stream },
        threadID,
        (err, data) => (err ? reject(err) : resolve(data?.messageID)),
      );
    });
  }
  return lastId;
}
