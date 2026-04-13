/**
 * /meme — Random Reddit Meme Generator
 *
 * Fetches a random image post from a curated list of high-density meme subreddits.
 * Implements a "Next Meme" button to allow users to endlessly scroll fresh memes.
 *
 * ── Image Extraction Logic ───────────────────────────────────────────────────
 * Reddit's JSON API provides multiple post formats. This module explicitly
 * extracts standard image posts and the first image from gallery posts while
 * filtering out videos and text-only (self) posts.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';

// Subreddits chosen for consistently high image-post density and meme relevance
const SUBREDDITS = [
  'dankmemes',
  'PampamilyangPaoLUL',
  'NANIKPosting',
  'memes',
  'MemeTemplatesOfficial',
  'HistoryMemes',
  'Memes_Of_The_Dank',
  'meme',
  'dank_meme',
  'Animemes',
  'shitpost',
  'shitposting',
];

export const config = {
  name: 'meme',
  aliases: ['memes'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'System',
  description: 'Fetch a random meme from Reddit',
  category: 'Fun',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

/** Formats large numbers into readable thousands (e.g. 4700 -> 4.7K) */
function fmt(n: number | null | undefined): string {
  if (n === undefined || n === null) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

/**
 * Extracts a usable image URL from a Reddit post object.
 * Handles standard images and multi-image galleries while skipping videos.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImageUrl(post: any): string | null {
  // Skip unsupported formats
  if (post.is_video || post.is_self || post.over_18) return null;

  // Gallery — use the first image in the declared gallery order
  if (
    post.is_gallery &&
    post.media_metadata &&
    post.gallery_data?.items?.length
  ) {
    const firstItem = post.gallery_data.items[0];
    const meta = post.media_metadata[firstItem.media_id];
    if (meta?.status === 'valid' && meta.s?.u) {
      // Reddit HTML-encodes ampersands in preview URLs; decode them for direct access
      return meta.s.u.replace(/&amp;/g, '&');
    }
  }

  // Direct image post
  const url = post.url_overridden_by_dest || post.url || '';
  if (url.match(/\.(jpg|jpeg|png|gif)(\?|$)/i)) return url;

  return null;
}

/**
 * Iteratively fetches posts until a valid image meme is found.
 * Capped at 10 attempts to prevent infinite loops if Reddit returns only videos.
 */
async function fetchMeme() {
  const MAX_ATTEMPTS = 10;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const src =
        SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)] ?? 'memes';

      // raw_json=1 bypasses Reddit's mobile User-Agent detection redirect
      const res = await axios.get(
        `https://www.reddit.com/r/${src}.json?raw_json=1&limit=100`,
        {
          headers: { Accept: 'application/json' },
          timeout: 10000,
        },
      );

      if (!res.data?.data?.children) continue;

      // Build a candidate pool from all posts that have extractable images
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidates = res.data.data.children
        .map(({ data }: any) => ({ data, url: extractImageUrl(data) }))
        .filter(({ url }: { url: string | null }) => !!url);

      if (!candidates.length) continue;

      const { data: post, url } =
        candidates[Math.floor(Math.random() * candidates.length)];

      return {
        title: post.title as string,
        url: url as string,
        subreddit: (post.subreddit || src) as string,
        score: post.score as number,
        numComments: post.num_comments as number,
      };
    } catch (err) {
      if (attempts >= MAX_ATTEMPTS) {
        throw new Error('Could not load meme from Reddit after max attempts');
      }
    }
  }
  throw new Error('Max attempts reached');
}

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔄 Next Meme',
    style: ButtonStyle.PRIMARY,
    // Re-invokes onCommand so the refresh replaces the current meme via editMessage, reducing chat clutter.
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const meme = await fetchMeme();

    // Limit interactive buttons to platforms that properly support visual components

    // Isolate file extension to ensure proper MIME resolution during platform download
    const extMatch = meme.url.match(/\.(jpg|jpeg|png|gif)(\?|$)/i);
    const ext = extMatch ? extMatch[1] : 'jpg';

    // Reuse the active instance ID if triggered via button; generate a new one if fresh command
    const buttonId = event['type'] === 'button_action' ? session.id : button.generateID({ id: BUTTON_ID.next, public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: [
        `**${meme.title || 'Untitled Meme'}**`,
        `📍 r/${meme.subreddit}  |  👍 ${fmt(meme.score)}  |  💬 ${fmt(meme.numComments)}`,
      ].join('\n'),
      attachment_url: [{ name: `meme.${ext}`, url: meme.url }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    // Update the existing message if triggered via button; otherwise send a new message
    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch (err) {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: '❌ Failed to fetch a fresh meme. Please try again later!',
    };
    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
};
