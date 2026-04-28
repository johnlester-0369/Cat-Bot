/**
 * Edits the body of a previously sent message via fca-unofficial.
 * Note the fca arg order: editMessage(body, messageID, cb) — body comes first,
 * which is the inverse of our unified API signature (messageID, newBody).
 */

import { mdToText } from '@/engine/utils/md-to-text.util.js';
import type { EditMessageOptions } from '@/engine/adapters/models/api.model.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
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
  options: string | EditMessageOptions,
): Promise<void> {
  let content = typeof options === 'string' ? options : (options.message ?? '');
  if (typeof content !== 'string')
    content =
      content.message ??
      ((content as Record<string, unknown>).body as string) ??
      '';

  const style = typeof options === 'object' ? options.style : undefined;
  // Apply unicode text formatting to simulate markdown in platforms lacking native support
  const finalContent = style === MessageStyle.MARKDOWN ? mdToText(content) : content;

  return new Promise((resolve, reject) => {
    api.editMessage(finalContent, messageID, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}
