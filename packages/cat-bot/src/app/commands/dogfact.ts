/**
 * /dogfact — Random Dog Fact
 *
 * Fetches a single random dog fact from the Dog API v2 /facts endpoint
 * and sends it as a formatted markdown message. An "Another Fact" button
 * swaps the fact in-place on every click without spamming new messages.
 *
 * Usage: !dogfact
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DogFactAttributes {
  body: string;
}

interface DogFactData {
  id: string;
  type: string;
  attributes: DogFactAttributes;
}

interface DogFactResponse {
  data: DogFactData[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchDogFact(): Promise<string> {
  const { data: json } = await axios.get<DogFactResponse>(
    'https://dogapi.dog/api/v2/facts?limit=1',
  );

  const fact = json.data[0];
  if (!fact?.attributes?.body) throw new Error('No fact returned from the API.');

  return fact.attributes.body;
}

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'dogfact',
  aliases: ['df', 'dogfacts'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random fun fact about dogs.',
  category: 'fun',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button Definitions ────────────────────────────────────────────────────────

const BUTTON_ID = { another: 'another' } as const;

export const button = {
  [BUTTON_ID.another]: {
    label: '🐾 Another Fact',
    style: ButtonStyle.PRIMARY,

    onClick: async ({ chat, event, button: btn, session }: AppCtx): Promise<void> => {
      try {
        const fact = await fetchDogFact();

        await chat.editMessage({
          message_id_to_edit: event['messageID'] as string,
          style: MessageStyle.MARKDOWN,
          message: `🐶 **Dog Fact**\n\n${fact}`,
          button: [session.id],
        });
      } catch (err) {
        const error = err as { message?: string };
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
        });
      }
    },
  },
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat, button: btn }: AppCtx): Promise<void> => {
  try {
    const fact = await fetchDogFact();

    const anotherId = btn.generateID({ id: BUTTON_ID.another, public: true });

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🐶 **Dog Fact**\n\n${fact}`,
      button: [anotherId],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};