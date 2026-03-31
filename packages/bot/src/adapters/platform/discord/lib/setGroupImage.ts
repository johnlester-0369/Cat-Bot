/**
 * Sets a Discord guild's icon.
 * guild.setIcon accepts URL strings, Buffers, and data URIs — but not Readable streams,
 * so we convert any stream to Buffer before passing to the API.
 */
import type { Guild } from 'discord.js';
import type { Readable } from 'stream';
import { streamToBuffer } from '../utils/helper.util.js';

export async function setGroupImage(
  guild: Guild | null,
  imageSource: string | Buffer | Readable,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  // Convert streams to Buffer — guild.setIcon does not accept Readable streams
  const icon =
    typeof imageSource === 'string' || Buffer.isBuffer(imageSource)
      ? imageSource
      : await streamToBuffer(imageSource);
  await guild.setIcon(icon);
}
