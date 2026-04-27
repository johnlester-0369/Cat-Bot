/**
 * send_result Tool — Unified Delivery of AI-Synthesized Response + Captured Attachments/Buttons
 *
 * Replaces the previous single-key replay approach with a composable model:
 *   - The LLM writes the message text itself (synthesized from test_command `calls`)
 *   - URL attachments from one or more test_command runs are merged via attachment keys
 *   - Button grids from one or more test_command runs are stacked via button keys
 *   - Everything is delivered in a single replyMessage call
 *
 * This eliminates the N-messages-for-N-commands problem: when the user asks for
 * multiple commands the LLM runs all test_command calls, reads all `calls` arrays,
 * writes one coherent reply text, and calls send_result exactly once.
 *
 * Key formats:
 *   attachment_key: `${baseKey}:a` — set by test_command, deleted here after use
 *   button_key:     `${baseKey}:b` — set by test_command, deleted here after use
 *
 * Attachment replay fidelity:
 *   - attachment_url (URL strings)  → replayed; platform wrapper downloads fresh
 *   - attachment (stream / Buffer)  → NOT included; consumed during mock proxy capture
 *   - button (ButtonItem[][])        → replayed; JSON-safe plain objects survive storage
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { commandResultStore } from '../lib/command-result-store.lib.js';
import type {
  NamedStreamAttachment,
  NamedUrlAttachment,
  ButtonItem,
  ReplyMessageOptions,
} from '@/engine/adapters/models/interfaces/api.interfaces.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { BinaryAttachment } from '../lib/command-result-store.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'send_result',
  description:
    'Deliver a unified reply to the user combining your synthesized message text with ' +
    'URL attachments (attachment_url) and button grids captured by one or more test_command calls. ' +
    'Write the `message` yourself based on the `calls` content returned by test_command. ' +
    'Pass any non-null `attachment_key` values in `attachment_url` and any non-null ' +
    '`button_key` values in `button` — all entries are merged into a single platform reply. ' +
    'Run all needed test_command calls before calling this tool once to combine results. ' +
    'Each key is single-use and is deleted after delivery.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'Your synthesized reply text. Write this yourself based on the `calls` ' +
          'text returned by test_command — do not copy raw command output verbatim. ' +
          'This is the primary text the user will see.',
      },
      attachment_url: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of `attachment_key` values returned by test_command (the ' +
          '`attachment_key` field, not the main `key`). URL-based file attachments from ' +
          'all provided keys are merged into the single reply. Omit or pass [] when ' +
          'no commands produced attachments.',
      },
      attachment: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of `binary_attachment_key` values returned by test_command. ' +
          'Buffer-based file attachments (e.g. raw images from commands like /cat) from ' +
          'all provided keys are merged into the single reply. Omit or pass [] when ' +
          'no commands produced binary attachments.',
      },
      button: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of `button_key` values returned by test_command (the ' +
          '`button_key` field, not the main `key`). Button rows from all provided ' +
          'keys are stacked into one combined keyboard layout. Omit or pass [] when ' +
          'no commands produced buttons.',
      },
    },
    required: ['message'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  {
    message,
    attachment_url,
    button,
    attachment,
  }: { message: string; attachment_url?: string[]; button?: string[]; attachment?: string[] },
  ctx: AppCtx,
): Promise<string> => {
  const threadID = (ctx.event['threadID'] as string) || '';
  // Thread the agent reply to the user's triggering message for visual conversation anchoring.
  const replyToID = (ctx.event['messageID'] as string) || '';

  // Collect and flatten all URL-based attachments from provided attachment keys.
  // Each key may hold multiple attachment entries from a single test_command run;
  // concatenating them preserves the order in which commands were tested.
  const allAttachmentUrls: NamedUrlAttachment[] = [];
  for (const aKey of attachment_url ?? []) {
    const urls = commandResultStore.getAttachments(aKey);
    if (urls) allAttachmentUrls.push(...(urls as NamedUrlAttachment[]));
    // Always delete even when null — guard against stale or double-consumed keys
    commandResultStore.deleteAttachments(aKey);
  }

  // Collect Buffer-based attachments captured before normalizeToJson in test_command.
  // Forwarded as raw file streams — the platform wrapper handles the actual upload,
  // so no intermediate re-fetch is needed here unlike URL-based attachments.
  const allBinaryAttachments: BinaryAttachment[] = [];
  for (const binKey of attachment ?? []) {
    const binaries = commandResultStore.getBinaryAttachments(binKey);
    if (binaries) allBinaryAttachments.push(...binaries);
    commandResultStore.deleteBinaryAttachments(binKey);
  }

  // Collect and stack button rows from all provided button keys.
  // Each key holds an array of ButtonItem[][] (one per API call that produced buttons).
  // Stacking all rows into a flat ButtonItem[][] gives the user one unified keyboard.
  const allButtonRows: ButtonItem[][] = [];
  for (const bKey of button ?? []) {
    const grids = commandResultStore.getButtons(bKey);
    if (grids) {
      for (const grid of grids) {
        // Double cast via unknown bypasses TS2352 strict overlap requirements
        allButtonRows.push(...(grid as unknown as ButtonItem[][]));
      }
    }
  }


  // Always deliver as markdown — the LLM composes formatted text (bold, lists, code) and it
  // must render correctly on all platforms. Thread to the user's triggering message (replyToID)
  // so the agent's response is visually anchored to the conversation turn that initiated it.
  const replyOptions: ReplyMessageOptions = {
    message,
    style: MessageStyle.MARKDOWN,
    ...(replyToID ? { reply_to_message_id: replyToID } : {}),
  };
  if (allAttachmentUrls.length > 0) replyOptions.attachment_url = allAttachmentUrls;
  if (allButtonRows.length > 0) replyOptions.button = allButtonRows;
  try {
    // Cast directly to NamedStreamAttachment[] to satisfy exactOptionalPropertyTypes: true
    if (allBinaryAttachments.length > 0) replyOptions.attachment = allBinaryAttachments as NamedStreamAttachment[];
    await ctx.api.replyMessage(threadID, replyOptions);

    const parts: string[] = ['Message delivered.'];
    if (allAttachmentUrls.length > 0)
      parts.push(`${allAttachmentUrls.length} attachment(s) included.`);
    if (allButtonRows.length > 0)
      parts.push(`${allButtonRows.length} button row(s) included.`);
    if (allBinaryAttachments.length > 0)
      parts.push(`${allBinaryAttachments.length} binary attachment(s) included.`);
    return parts.join(' ');
  } catch (err) {
    return `Delivery failed: ${err instanceof Error ? err.message : String(err)}`;
  }
};
