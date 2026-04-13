/**
 * Facebook Page — Graph API HTTP Helpers
 *
 * Low-level functions that translate application-level send requests into
 * Graph API HTTP calls. Separated from pageApi.ts so the factory function
 * stays focused on state management (page ID caching) and callback wrapping.
 *
 * These helpers are internal to the facebook-page module — only pageApi.ts
 * imports them directly.
 */

import axios from 'axios';
import FormData from 'form-data';
import type { Readable } from 'stream';

const FB_API_VERSION = 'v22.0';

// Exported so pageApi.ts can reuse the base URL for getUserInfo/getMessage/fetchPageId
// without duplicating the version string across files.
export const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

const MESSAGING_TYPE = 'RESPONSE';

// Extension-based heuristic — Graph API requires the attachment type field to match
// the actual MIME type; audio extensions must be sent as type "audio", everything
// else as type "image" (which also covers stickers rendered as images).
const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'wav', 'm4a', 'aac', 'opus']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv']);

function getAttachmentType(filename: string): 'audio' | 'image' {
  const ext = (filename || '').split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.has(ext) ? 'audio' : 'image';
}

/**
 * Derives the Graph API attachment type from a filename or URL path.
 * Used when sending URL-based attachments — the Send API requires an explicit
 * `type` field that matches the media category.
 * Strips query-string suffixes before checking extension so ephemeral CDN URLs
 * like "meme.jpg?v=12345" are classified correctly.
 * Falls back to 'image' because most bot-delivered media is image content.
 */
export function getAttachmentTypeFromExt(
  filename: string,
): 'image' | 'video' | 'audio' | 'file' {
  const ext =
    (filename || '').split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext))
    return 'image';
  return 'file';
}

interface GraphMessageResponse {
  message_id?: string;
}

export async function sendTextMessage(
  pageAccessToken: string,
  recipientId: string,
  messageObj: Record<string, unknown>,
): Promise<GraphMessageResponse> {
  const res = await axios.post<GraphMessageResponse>(
    `${FB_API_BASE}/me/messages`,
    {
      recipient: { id: recipientId },
      message: messageObj,
      messaging_type: MESSAGING_TYPE,
    },
    { params: { access_token: pageAccessToken } },
  );
  return res.data;
}

/**
 * Sends a structured message template (e.g. Button Template) via the Graph API.
 * Used when replyMessage receives a `button` array — the Button Template is the
 * only FB Page API construct that pairs text with clickable postback buttons.
 * Template payload shapes: developers.facebook.com/docs/messenger-platform/send-messages/template/button
 */
export async function sendTemplateMessage(
  pageAccessToken: string,
  recipientId: string,
  templatePayload: Record<string, unknown>,
): Promise<GraphMessageResponse> {
  const res = await axios.post<GraphMessageResponse>(
    `${FB_API_BASE}/me/messages`,
    {
      recipient: { id: recipientId },
      message: { attachment: { type: 'template', payload: templatePayload } },
      messaging_type: MESSAGING_TYPE,
    },
    { params: { access_token: pageAccessToken } },
  );
  return res.data;
}

/**
 * Sends an attachment referenced by a public URL through the Graph API without
 * downloading it first. The Graph API fetches the asset server-side, eliminating
 * the download-then-reupload round-trip that stream-based sending requires.
 * Preferred for all URL-sourced assets (Reddit CDN, Imgur, etc.).
 *
 * Reference: developers.facebook.com/docs/messenger-platform/send-messages#url
 */
export async function sendUrlAttachment(
  pageAccessToken: string,
  recipientId: string,
  url: string,
  type: 'image' | 'video' | 'audio' | 'file' = 'image',
): Promise<GraphMessageResponse> {
  const res = await axios.post<GraphMessageResponse>(
    `${FB_API_BASE}/me/messages`,
    {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type,
          payload: {
            url,
            // Non-reusable: dynamic CDN links (Reddit, Imgur, etc.) expire and cannot be referenced later
            is_reusable: false,
          },
        },
      },
      messaging_type: MESSAGING_TYPE,
    },
    { params: { access_token: pageAccessToken } },
  );
  return res.data;
}
export async function sendAttachmentMessage(
  pageAccessToken: string,
  recipientId: string,
  stream: Readable & { path?: string },
): Promise<GraphMessageResponse> {
  const filename = stream.path || 'file.bin';
  const type = getAttachmentType(filename);
  const messageObj = { attachment: { type, payload: { is_reusable: false } } };

  const form = new FormData();
  form.append('recipient', JSON.stringify({ id: recipientId }));
  form.append('message', JSON.stringify(messageObj));
  form.append('messaging_type', MESSAGING_TYPE);
  form.append('filedata', stream, { filename });

  const res = await axios.post<GraphMessageResponse>(
    `${FB_API_BASE}/me/messages`,
    form,
    {
      headers: form.getHeaders(),
      params: { access_token: pageAccessToken },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );
  return res.data;
}
