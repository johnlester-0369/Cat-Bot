/**
 * /example-buttons — Interactive Button Demo
 *
 * Demonstrates the full button system lifecycle across Discord, Telegram, and Facebook Page:
 *
 *   User: /example-buttons
 *   Bot:  [message with three buttons: 🏓 Ping | 🌐 Platform | ❓ Help]
 *   User: [clicks 🏓 Ping]
 *   Bot:  🏓 Pong! The button system works.
 *
 * How it works:
 *   1. onCommand calls chat.reply({ button: [ACTION_ID.ping, ...] }) with bare action IDs.
 *   2. createChatContext.resolveButtons() prefixes each ID: "buttons:ping", "buttons:platform" etc.
 *   3. The platform sends those prefixed IDs as callback data (Discord: customId, Telegram:
 *      callback_data, FB Page: postback payload).
 *   4. When clicked, the platform emits 'button_action' with event.actionId = "buttons:ping".
 *   5. handleButtonAction in controllers/index.js splits on ':' → command "buttons", local "ping".
 *   6. menu["ping"].run(ctx) is called with the full context object.
 *
 * button_style values:
 *   'primary'   → Discord blue   (ButtonStyle.Primary)
 *   'secondary' → Discord grey   (ButtonStyle.Secondary) — default
 *   'success'   → Discord green  (ButtonStyle.Success)
 *   'danger'    → Discord red    (ButtonStyle.Danger)
 *   Telegram and Facebook Page ignore button_style (labels only).
 *
 * Platform notes:
 *   Discord      — buttons appear as interactive components below the message
 *   Telegram     — inline keyboard appears below the message
 *   Facebook Page — Button Template (max 3 buttons, title ≤20 chars)
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

export const config = {
  name: 'example_buttons',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Demo: sends a message with three interactive buttons',
  category: 'Example',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ACTION_IDs are the local keys used in the menu object.
// createChatContext.resolveButtons() prefixes them with the command name at dispatch time —
// command code never needs to know its own name or construct full callback IDs.
const ACTION_ID = {
  ping: 'ping',
  platform: 'platform',
  help: 'help',
};

/**
 * Button definitions exported as `menu`.
 * Keys match ACTION_ID values. `run` receives the same ctx shape as `onCommand`.
 */
export const menu = {
  [ACTION_ID.ping]: {
    label: '🏓 Ping',
    button_style: ButtonStyle.PRIMARY,
    run: async ({ chat }: AppCtx) => {
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: '🏓 **Pong!** The button system works.',
      });
    },
  },

  [ACTION_ID.platform]: {
    label: '🌐 Platform',
    button_style: ButtonStyle.SECONDARY,
    run: async ({ chat, event }: AppCtx) => {
      // event.platform is set by the platform's button_action event builder
      const platform = event['platform'] || 'unknown';
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: `You are chatting via: ${platform}`,
      });
    },
  },

  [ACTION_ID.help]: {
    label: '❓ Help',
    button_style: ButtonStyle.SUCCESS,
    run: async ({ chat }: AppCtx) => {
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message:
          'Available commands: `/help` · `/reply` (conversation flow) · `/react` (reaction flow) · `/example-buttons` (this demo)',
      });
    },
  },
};

/**
 * Entry point: sends the initial message with three buttons attached.
 * chat.reply() here uses the command-aware chat context created in dispatchCommand,
 * so button IDs are automatically resolved to "buttons:ping" etc. before the platform sees them.
 */
export const onCommand = async ({ chat }: AppCtx) => {
  await chat.reply({
    style: MessageStyle.MARKDOWN,
    message: '🎛️ **Choose an action:**',
    button: [ACTION_ID.ping, ACTION_ID.platform, ACTION_ID.help],
  });
};
