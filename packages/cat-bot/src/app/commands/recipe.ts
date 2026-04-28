/**
 * Recipe Command
 * Fetches a random meal recipe with instructions and ingredients.
 * Includes a "New Recipe" button to refresh without re-issuing the command.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

const TIMEOUT = 8000;
const API_URL = 'https://www.themealdb.com/api/json/v1/1/random.php';

export const config: CommandConfig = {
  name: 'recipe',
  aliases: ['meal', 'food', 'cook'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random recipe suggestion.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

interface MealDbMeal {
  strMeal: string;
  strCategory?: string;
  strArea?: string;
  strInstructions?: string;
  strMealThumb?: string;
  [key: string]: string | undefined;
}

interface MealDbResponse {
  meals?: MealDbMeal[];
}

async function fetchRecipe(): Promise<MealDbMeal | null> {
  try {
    const { data } = await axios.get<MealDbResponse>(API_URL, {
      timeout: TIMEOUT,
    });
    return data?.meals?.[0] ?? null;
  } catch {
    return null;
  }
}

function formatRecipe(meal: MealDbMeal): string {
  const ingredients: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = (meal[`strIngredient${i}`] ?? '').trim();
    const measure = (meal[`strMeasure${i}`] ?? '').trim();
    if (ing) {
      ingredients.push(`- ${ing}${measure ? ` (${measure})` : ''}`);
    }
  }

  let caption =
    `🍽️ **${meal.strMeal}**\n` +
    `📂 Category: ${meal.strCategory ?? 'Misc'}\n` +
    `🌎 Area: ${meal.strArea ?? 'Unknown'}\n\n` +
    `📝 **Instructions:**\n${meal.strInstructions ?? 'No instructions provided.'}\n\n` +
    `🥕 **Ingredients:**\n${ingredients.join('\n')}`;

  // Telegram caption limit — trim if needed
  if (caption.length > 1020) {
    caption = caption.substring(0, 1015) + '...';
  }

  return caption;
}

const BUTTON_ID = { newRecipe: 'new_recipe' } as const;

async function fetchAndSendRecipe(ctx: AppCtx): Promise<void> {
  const { chat, native, event, button, session } = ctx;

  try {
    const meal = await fetchRecipe();
    if (!meal)
      throw new Error('Could not fetch a recipe. The kitchen is closed.');

    const caption = formatRecipe(meal);

    // Reuse active instance ID if triggered via button; generate new one for fresh command
    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.newRecipe, public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      ...(meal.strMealThumb
        ? { attachment_url: [{ name: 'meal.jpg', url: meal.strMealThumb }] }
        : {}),
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch (err) {
    const error = err as { message?: string };
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
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
}

export const button = {
  [BUTTON_ID.newRecipe]: {
    label: '🔁 New Recipe',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => fetchAndSendRecipe(ctx),
  },
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await fetchAndSendRecipe(ctx);
};
