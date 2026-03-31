import { Client, GatewayIntentBits, Events } from 'discord.js';
import type { Guild, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createDiscordChannelApi } from '../../../src/adapters/platform/discord/wrapper.js';
import {
  createThreadContext,
  createChatContext,
  createBotContext,
  createUserContext,
} from '../../../src/adapters/models/context.model.js';
import {
  DISCORD_GUILD_ID,
  DISCORD_CHANNEL_ID,
  DISCORD_MESSAGE_ID,
  DISCORD_TARGET_USER_ID,
} from '../shared/test-ids.js';
import type { PlatformTestContext } from '../shared/test-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupDiscord(): Promise<PlatformTestContext | null> {
  let token: string | undefined;

  try {
    const credPath = path.join(
      __dirname,
      '../../../../session/discord/credential.json',
    );
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    token = creds.DISCORD_TOKEN;
  } catch {
    // Graceful fallback prevents crash if file is missing
  }

  if (!token) {
    console.warn(
      '[Discord] DISCORD_TOKEN missing in credential.json — Discord tests will be skipped',
    );
    return null;
  }

  try {
    const discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
      ],
    });

    await new Promise<void>((resolve, reject) => {
      discordClient.once(Events.ClientReady, () => resolve());
      discordClient.once('error', (e: Error) => reject(e));
      void discordClient.login(token);
    });

    const botUserId = discordClient.user?.id ?? null;
    const guild: Guild = await discordClient.guilds.fetch(DISCORD_GUILD_ID);
    await guild.channels.fetch();

    const channel = (guild.channels.cache.get(DISCORD_CHANNEL_ID) ??
      guild.systemChannel ??
      guild.channels.cache.find(
        (c) => c?.isTextBased() && !c.isThread() && !c.isDMBased(),
      )) as TextChannel | undefined;

    if (!channel) {
      console.warn(
        `[Discord] No text channel found in guild ${DISCORD_GUILD_ID}`,
      );
      discordClient.destroy();
      return null;
    }

    const discordApi = createDiscordChannelApi(channel, guild);
    const baseEvent = {
      threadID: DISCORD_CHANNEL_ID,
      messageID: DISCORD_MESSAGE_ID,
      senderID: DISCORD_TARGET_USER_ID,
      userID: DISCORD_TARGET_USER_ID,
    };

    console.info(
      `[Discord] Connected — bot: ${botUserId}, channel: #${channel.name} (${DISCORD_CHANNEL_ID})`,
    );

    return {
      platformName: 'Discord',
      api: discordApi,
      chatCtx: createChatContext(discordApi, baseEvent),
      threadCtx: createThreadContext(discordApi, baseEvent),
      userCtx: createUserContext(discordApi),
      botCtx: createBotContext(discordApi),
      botUserId,
      targetUserId: DISCORD_TARGET_USER_ID,
      threadId: DISCORD_CHANNEL_ID,
      messageId: DISCORD_MESSAGE_ID,
      teardown: () => {
        discordClient.destroy();
      },
    };
  } catch (err) {
    console.warn(`[Discord] Setup failed: ${(err as Error).message}`);
    return null;
  }
}
