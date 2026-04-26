/**
 * play.ts — Music Search & Play (Dual Source)
 *
 * Searches for a song on Spotify or YouTube and sends the audio directly.
 *
 * Usage:
 *   !play one last kiss - hikaru utada
 *   !play one last kiss - hikaru utada -i 2
 *   !play one last kiss -s spotify
 *   !play one last kiss -s spotify -i 1
 *
 * Flags (parsed from positional args — no ctx.flag() equivalent in Cat-Bot):
 *   -i <number>   Index of search result to use (default: 0)
 *   -s <text>     Source: 'spotify' or 'youtube' (default: 'youtube')
 *
 * Coin cost: 5 per use (enforced manually via currencies — there is no
 * config-level coin gate in Cat-Bot's CommandConfig).
 *
 * ── Conversion gaps flagged ──────────────────────────────────────────────────
 * ❌ ctx.flag()                     → No equivalent. Flags are parsed from args manually.
 * ❌ tools.msg.generateInstruction  → No equivalent. usage() is used instead.
 * ❌ tools.msg.generateCmdExample   → No equivalent. usage() is used instead.
 * ❌ tools.msg.generatesFlagInfo    → No equivalent. usage() is used instead.
 * ❌ tools.cmd.handleError          → No equivalent. Standard try/catch is used.
 * ❌ ctx.reply({ audio: { url } })  → Cat-Bot uses attachment: [{ name, stream: Buffer }]
 * ❌ formatter.bold()               → No equivalent. **Markdown** is used directly.
 * ❌ permissions: { coin: 5 }       → Not a config field. Enforced via currencies manually.
 *
 * API providers (resolved via createUrl from @/engine/utils/api.util.js):
 *   Spotify search  → nexray  /search/spotify
 *   Spotify dl      → chocomilk  /v1/download/spotify
 *   YouTube search  → chocomilk  /v1/youtube/search
 *   YouTube dl      → chocomilk  /v1/youtube/download
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'play',
  aliases: ['song', 'music'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'converted',
  description: 'Search for a song on Spotify or YouTube and send the audio.',
  category: 'Downloader',
  usage: [
    '<song title or artist>',
    '<query> -i <number>  — Pick result by index (default: 0)',
    '<query> -s spotify   — Use Spotify source (default: youtube)',
  ],
  cooldown: 8,
  hasPrefix: true,
};

// ── Response shapes ───────────────────────────────────────────────────────────

interface SpotifySearchItem {
  name: string;
  artist: string;
  url: string;
}

interface SpotifySearchResponse {
  result: SpotifySearchItem[];
}

interface SpotifyDownloadResponse {
  data: { media: { url: string } };
}

interface YouTubeSearchItem {
  type: string;
  title: string;
  url: string;
  author: { name: string };
}

interface YouTubeSearchResponse {
  data: { all: YouTubeSearchItem[] };
}

interface YouTubeDownloadResponse {
  data: { download: string };
}

// ── Flag parser ───────────────────────────────────────────────────────────────
// ctx.flag() has no Cat-Bot equivalent — flags are parsed from args manually.

interface ParsedFlags {
  input: string;
  index: number;
  source: string;
}

function parseFlags(args: string[]): ParsedFlags {
  let index = 0;
  let source = 'youtube';
  const inputParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const cur = args[i] as string;
    if ((cur === '-i' || cur === '--index') && args[i + 1] !== undefined) {
      const val = parseInt(args[++i] as string, 10);
      index = isNaN(val) || val < 0 ? 0 : val;
    } else if ((cur === '-s' || cur === '--source') && args[i + 1] !== undefined) {
      source = (args[++i] as string).toLowerCase();
    } else {
      inputParts.push(cur);
    }
  }

  return { input: inputParts.join(' ').trim(), index, source };
}

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  event,
  currencies,
  usage,
}: AppCtx): Promise<void> => {
  // ── Guard: require input ────────────────────────────────────────────────────
  if (!args.length) return usage();

  const { input, index, source } = parseFlags(args);

  if (!input) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⚠️ Please provide a song title or artist name.',
    });
    return;
  }

  // ── Coin gate (5 coins per use) ────────────────────────────────────────────
  // permissions: { coin: 5 } has no Config-level equivalent in Cat-Bot.
  const senderID = event['senderID'] as string;
  const balance = await currencies.getMoney(senderID);
  if (balance < 5) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ You need at least **5 coins** to use this command.\nYour balance: **${balance} coins**`,
    });
    return;
  }
  await currencies.decreaseMoney({ user_id: senderID, money: 5 });

  // ── Loading indicator ──────────────────────────────────────────────────────
  const waitId = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `🔍 Searching for **${input}** on **${source === 'spotify' ? 'Spotify' : 'YouTube'}**...`,
  });

  try {
    if (source === 'spotify') {
      // ── Spotify path ──────────────────────────────────────────────────────
      const searchUrl = createUrl('nexray', '/search/spotify', { q: input });
      if (!searchUrl) throw new Error('Failed to build Spotify search URL.');

      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok)
        throw new Error(`Spotify search failed (${searchRes.status})`);
      const searchData = (await searchRes.json()) as SpotifySearchResponse;

      const results = searchData?.result;
      if (!results?.length)
        throw new Error('No Spotify results found for that query.');
      const track = results[index];
      if (!track)
        throw new Error(`No result at index ${index} (found ${results.length}).`);

      // Show metadata before downloading
      if (waitId) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: waitId as string,
          message:
            `🎵 Found on Spotify:\n` +
            `• **Title:** ${track.name}\n` +
            `• **Artist:** ${track.artist}\n` +
            `⬇️ Downloading...`,
        });
      }

      const dlUrl = createUrl('chocomilk', '/v1/download/spotify', {
        url: track.url,
      });
      if (!dlUrl) throw new Error('Failed to build Spotify download URL.');

      const dlRes = await fetch(dlUrl);
      if (!dlRes.ok)
        throw new Error(`Spotify download failed (${dlRes.status})`);
      const dlData = (await dlRes.json()) as SpotifyDownloadResponse;
      const audioUrl = dlData?.data?.media?.url;
      if (!audioUrl) throw new Error('Download API returned no audio URL.');

      // Download audio buffer and send as attachment
      const audioRes = await fetch(audioUrl, {
        signal: AbortSignal.timeout(30000),
      });
      if (!audioRes.ok)
        throw new Error(`Audio fetch failed (${audioRes.status})`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      if (waitId) await chat.unsendMessage(waitId as string).catch(() => {});

      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: `🎵 **${track.name}** — ${track.artist}`,
        attachment: [
          {
            name: `${track.name.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`,
            stream: audioBuffer,
          },
        ],
      });
    } else {
      // ── YouTube path (default) ────────────────────────────────────────────
      const searchUrl = createUrl('chocomilk', '/v1/youtube/search', {
        query: input,
      });
      if (!searchUrl) throw new Error('Failed to build YouTube search URL.');

      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok)
        throw new Error(`YouTube search failed (${searchRes.status})`);
      const searchData = (await searchRes.json()) as YouTubeSearchResponse;

      const videos = searchData?.data?.all?.filter(
        (r) => r.type === 'video',
      ) ?? [];
      if (!videos.length)
        throw new Error('No YouTube video results found for that query.');
      const video = videos[index];
      if (!video)
        throw new Error(`No video at index ${index} (found ${videos.length}).`);

      if (waitId) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: waitId as string,
          message:
            `🎵 Found on YouTube:\n` +
            `• **Title:** ${video.title}\n` +
            `• **Channel:** ${video.author.name}\n` +
            `⬇️ Downloading...`,
        });
      }

      const dlUrl = createUrl('chocomilk', '/v1/youtube/download', {
        url: video.url,
        mode: 'audio',
      });
      if (!dlUrl) throw new Error('Failed to build YouTube download URL.');

      const dlRes = await fetch(dlUrl);
      if (!dlRes.ok)
        throw new Error(`YouTube download failed (${dlRes.status})`);
      const dlData = (await dlRes.json()) as YouTubeDownloadResponse;
      const audioUrl = dlData?.data?.download;
      if (!audioUrl) throw new Error('Download API returned no audio URL.');

      const audioRes = await fetch(audioUrl, {
        signal: AbortSignal.timeout(30000),
      });
      if (!audioRes.ok)
        throw new Error(`Audio fetch failed (${audioRes.status})`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      if (waitId) await chat.unsendMessage(waitId as string).catch(() => {});

      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: `🎵 **${video.title}** — ${video.author.name}`,
        attachment: [
          {
            name: `${video.title.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`,
            stream: audioBuffer,
          },
        ],
      });
    }
  } catch (err) {
    const error = err as { message?: string };
    if (waitId) await chat.unsendMessage(waitId as string).catch(() => {});
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Failed to fetch audio.**\n\`${error.message ?? 'Unknown error'}\``,
    });
  }
};