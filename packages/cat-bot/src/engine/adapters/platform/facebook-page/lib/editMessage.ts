/**
 * Facebook Page — editMessage
 *
 * The Facebook Page API does not support editing messages natively.
 * This acts as a fallback by sending the edited payload as a new message.
 * It intelligently delegates to replyMessage if buttons are present,
 * otherwise falling back to sendMessage.
 */

import type { PageApi } from '../pageApi.js';
import type { EditMessageOptions } from '@/engine/adapters/models/api.model.js';
import { replyMessage } from './replyMessage.js';
import { sendMessage } from './sendMessage.js';

export async function editMessage(
  pageApi: PageApi,
  messageID: string,
  options: string | EditMessageOptions,
): Promise<void> {
  // Extract implicitly injected threadID from the chat context execution
  const threadID =
    typeof options === 'object' && options.threadID ? options.threadID : null;

  if (!threadID) {
    throw new Error(
      `editMessage fallback failed on Facebook Page: threadID is missing from options for message ${messageID}.`,
    );
  }

  // Fallback: Send as a new message to the thread. replyMessage handles FB button templates seamlessly.
  if (typeof options === 'object') {
    await replyMessage(pageApi, threadID, {
      message: options.message,
      button: options.button,
      style: options.style,
      // Forward stream and URL attachments so commands like /meme that pass attachment_url
      // on button_action events (editMessage path) still deliver their images. Without this
      // forward, the meme image is silently dropped and only the caption + button arrive.
      ...(options.attachment !== undefined
        ? { attachment: options.attachment }
        : {}),
      ...(options.attachment_url !== undefined
        ? { attachment_url: options.attachment_url }
        : {}),
    });
  } else {
    await sendMessage(pageApi, options, threadID);
  }
}
