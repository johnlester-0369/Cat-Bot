/**
 * /fish — Fishing Reward Command
 *
 * Cast your line and catch a fish (or junk) every 30 minutes.
 * Catches are distributed across five rarity tiers with escalating coin rewards.
 * Rare and legendary catches trigger an enhanced response for extra excitement.
 *
 * Collection schema (stored under the "fish" key in bot_users_session.data):
 *   {
 *     lastFish:    number  — Unix timestamp (ms) of the last fishing attempt
 *     totalCaught: number  — total number of successful catches (non-trash)
 *     totalEarned: number  — lifetime coins earned from fishing
 *     castCount:   number  — total number of times the rod was cast
 *   }
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

export const config: CommandConfig = {
  name: 'fish',
  aliases: ['fishing', 'cast', 'reel'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Cast your line and earn coins based on what you catch.',
  category: 'Economy',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/** 30-minute cooldown between casts. */
const COOLDOWN_MS = 30 * 60 * 1000;

// ── Catch Definitions ─────────────────────────────────────────────────────────

type Rarity = 'trash' | 'common' | 'uncommon' | 'rare' | 'legendary';

interface CatchEntry {
  name: string;
  emoji: string;
  rarity: Rarity;
  /** [min, max] coin range; trash can be negative (disposal fee). */
  value: [number, number];
  flavour: string;
}

/**
 * Cumulative probability thresholds:
 *   trash      25%
 *   common     32%
 *   uncommon   22%
 *   rare       14%
 *   legendary   7%
 */
const RARITY_THRESHOLDS: [Rarity, number][] = [
  ['trash', 0.25],
  ['common', 0.57],
  ['uncommon', 0.79],
  ['rare', 0.93],
  ['legendary', 1.0],
];

const RARITY_LABELS: Record<Rarity, string> = {
  trash: '🗑️ Trash',
  common: '🟢 Common',
  uncommon: '🔵 Uncommon',
  rare: '🟣 Rare',
  legendary: '🌟 Legendary',
};

const CATCH_TABLE: CatchEntry[] = [
  // ── Trash ─────────────────────────────────────────────────────────────────
  {
    name: 'Old Boot',
    emoji: '👟',
    rarity: 'trash',
    value: [-5, 5],
    flavour: 'A waterlogged boot that belongs in a landfill, not a lake.',
  },
  {
    name: 'Rusty Can',
    emoji: '🥫',
    rarity: 'trash',
    value: [-10, 2],
    flavour: 'Someone thought the river was a recycling bin.',
  },
  {
    name: 'Tangled Seaweed',
    emoji: '🌿',
    rarity: 'trash',
    value: [0, 3],
    flavour: 'At least the water is clear. This happens to everyone.',
  },
  {
    name: 'Soggy Hat',
    emoji: '🎩',
    rarity: 'trash',
    value: [-5, 10],
    flavour: 'A vintage find? Only if you like the smell of wet fabric.',
  },
  {
    name: 'Plastic Bag',
    emoji: '🛍️',
    rarity: 'trash',
    value: [-5, 0],
    flavour:
      "You did the environment a favour by pulling this out. Doesn't pay well though.",
  },

  // ── Common ────────────────────────────────────────────────────────────────
  {
    name: 'Sardine',
    emoji: '🐟',
    rarity: 'common',
    value: [20, 55],
    flavour:
      'Small but plentiful. The fishmonger will take them off your hands.',
  },
  {
    name: 'Carp',
    emoji: '🐠',
    rarity: 'common',
    value: [25, 65],
    flavour: 'A reliable catch. Not glamorous, but coins are coins.',
  },
  {
    name: 'Catfish',
    emoji: '🐡',
    rarity: 'common',
    value: [30, 70],
    flavour: 'Whiskers and all — this one put up a brief fight. You won.',
  },
  {
    name: 'Perch',
    emoji: '🐟',
    rarity: 'common',
    value: [20, 60],
    flavour: 'A decent afternoon catch. Nothing to write home about.',
  },
  {
    name: 'Mackerel',
    emoji: '🐠',
    rarity: 'common',
    value: [28, 68],
    flavour: 'Oily, flavourful, and worth a few coins at the market.',
  },

  // ── Uncommon ──────────────────────────────────────────────────────────────
  {
    name: 'Bass',
    emoji: '🎣',
    rarity: 'uncommon',
    value: [80, 160],
    flavour: 'A firm, meaty bass. Sport fishers would be envious.',
  },
  {
    name: 'Rainbow Trout',
    emoji: '🐟',
    rarity: 'uncommon',
    value: [90, 175],
    flavour: 'Iridescent scales shimmer in the sun. Premium table fare.',
  },
  {
    name: 'Flounder',
    emoji: '🐡',
    rarity: 'uncommon',
    value: [75, 155],
    flavour: 'Flat and peculiar-looking, but restaurants love them.',
  },
  {
    name: 'Snapper',
    emoji: '🐠',
    rarity: 'uncommon',
    value: [85, 165],
    flavour: 'Sharp teeth, good price. Handle carefully.',
  },
  {
    name: 'Grouper',
    emoji: '🐟',
    rarity: 'uncommon',
    value: [95, 180],
    flavour: 'A chunky, valuable catch that took real strength to reel in.',
  },

  // ── Rare ──────────────────────────────────────────────────────────────────
  {
    name: 'Bluefin Tuna',
    emoji: '🐋',
    rarity: 'rare',
    value: [200, 380],
    flavour:
      'A market delicacy. The auction house will open its doors for this.',
  },
  {
    name: 'Atlantic Salmon',
    emoji: '🐟',
    rarity: 'rare',
    value: [180, 340],
    flavour: 'Wild-caught salmon fetches a premium. The river delivered today.',
  },
  {
    name: 'Swordfish',
    emoji: '🗡️',
    rarity: 'rare',
    value: [220, 400],
    flavour: 'It put up a legendary fight. Your arms will feel it tomorrow.',
  },
  {
    name: 'Giant Squid',
    emoji: '🦑',
    rarity: 'rare',
    value: [190, 360],
    flavour:
      "The tentacles nearly pulled you in. Nearly. You're richer for it.",
  },
  {
    name: 'Electric Eel',
    emoji: '⚡',
    rarity: 'rare',
    value: [210, 390],
    flavour:
      'You took a small shock, but the research institute paid generously.',
  },

  // ── Legendary ─────────────────────────────────────────────────────────────
  {
    name: 'Golden Koi',
    emoji: '✨',
    rarity: 'legendary',
    value: [500, 900],
    flavour:
      'A mythical fish said to bring fortune to whoever catches it. Today that is you.',
  },
  {
    name: "Mermaid's Pearl",
    emoji: '🪨',
    rarity: 'legendary',
    value: [600, 1000],
    flavour:
      'Not a fish — but a flawless pearl tangled in your line. Worth a small fortune.',
  },
  {
    name: 'Kraken Tentacle',
    emoji: '🦑',
    rarity: 'legendary',
    value: [550, 950],
    flavour:
      'You reeled in something the deep preferred to keep. Marine biologists are calling.',
  },
  {
    name: 'Oarfish',
    emoji: '🐍',
    rarity: 'legendary',
    value: [480, 880],
    flavour:
      'The sea serpent of legend — 8 metres of silver scales. Museums are bidding.',
  },
  {
    name: 'Ghost Carp',
    emoji: '👻',
    rarity: 'legendary',
    value: [520, 920],
    flavour:
      'Completely white, with eyes like polished glass. Collectors pay absurd sums.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pad = (n: number): string => String(n).padStart(2, '0');

function formatRemaining(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${pad(m)}m`);
  parts.push(`${pad(s)}s`);
  return parts.join(' ');
}

function rollCatch(): CatchEntry {
  const roll = Math.random();
  let rarity: Rarity = 'legendary';
  for (const [tier, threshold] of RARITY_THRESHOLDS) {
    if (roll < threshold) {
      rarity = tier;
      break;
    }
  }
  const pool = CATCH_TABLE.filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// ── Button Definitions ────────────────────────────────────────────────────────

const BUTTON_ID = {
  balance: 'balance',
  back: 'back',
} as const;

export const button = {
  // ── Balance button — shown on the catch result view ───────────────────────
  [BUTTON_ID.balance]: {
    label: '💰 My Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({
      chat,
      event,
      native,
      button: btn,
      currencies,
    }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) return;

      const coins = await currencies.getMoney(senderID);

      // Generate a scoped back button so only this user can navigate back
      const backId = btn.generateID({ id: BUTTON_ID.back, public: false });

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: `💰 **Your Balance:** ${coins.toLocaleString()} coins`,
        ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
      });
    },
  },

  // ── Back button — shown on the balance view, returns to fishing stats ─────
  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async ({
      chat,
      event,
      db,
      native,
      button: btn,
      prefix = '/',
    }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) return;

      // Regenerate balance button so the user can toggle back to balance again
      const balId = btn.generateID({ id: BUTTON_ID.balance, public: false });

      const userColl = db.users.collection(senderID);

      // If the user has no fish collection they have never cast — show a prompt
      if (!(await userColl.isCollectionExist('fish'))) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: `🎣 You haven't gone fishing yet! Use \`${prefix}fish\` to cast your first line.`,
          ...(hasNativeButtons(native.platform) ? { button: [balId] } : {}),
        });
        return;
      }

      const fishData = await userColl.getCollection('fish');

      const lastFish = (await fishData.get('lastFish')) as number | undefined;
      const totalCaught =
        ((await fishData.get('totalCaught')) as number | undefined) ?? 0;
      const totalEarned =
        ((await fishData.get('totalEarned')) as number | undefined) ?? 0;
      const castCount =
        ((await fishData.get('castCount')) as number | undefined) ?? 0;

      // Determine next-cast availability
      const now = Date.now();
      const castLine =
        !lastFish || now - lastFish >= COOLDOWN_MS
          ? `🎣 Your rod is **ready** — cast away!`
          : `⏰ Next cast in **${formatRemaining(COOLDOWN_MS - (now - lastFish))}**`;

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: [
          '🎣 **Fishing Stats**',
          ``,
          `🪣 Total Casts:   **${castCount.toLocaleString()}**`,
          `🐟 Total Catches: **${totalCaught.toLocaleString()}**`,
          `💰 Lifetime Earned: **${totalEarned.toLocaleString()} coins**`,
          ``,
          castLine,
        ].join('\n'),
        ...(hasNativeButtons(native.platform) ? { button: [balId] } : {}),
      });
    },
  },
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  db,
  native,
  button: btn,
  currencies,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;

  if (!senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  const userColl = db.users.collection(senderID);

  if (!(await userColl.isCollectionExist('fish'))) {
    await userColl.createCollection('fish');
  }

  const fishData = await userColl.getCollection('fish');
  const lastFish = (await fishData.get('lastFish')) as number | undefined;
  const now = Date.now();

  // ── Cooldown check ────────────────────────────────────────────────────────
  if (lastFish !== undefined && now - lastFish < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - (now - lastFish);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        '🎣 Your line is still in the water — patience!',
        `Cast again in **${formatRemaining(remaining)}**`,
      ].join('\n'),
    });
    return;
  }

  // ── Roll the catch ────────────────────────────────────────────────────────
  const caught = rollCatch();
  const isTrash = caught.rarity === 'trash';
  const value = randInt(caught.value[0], caught.value[1]);

  const prevCaught =
    ((await fishData.get('totalCaught')) as number | undefined) ?? 0;
  const prevEarned =
    ((await fishData.get('totalEarned')) as number | undefined) ?? 0;
  const prevCasts =
    ((await fishData.get('castCount')) as number | undefined) ?? 0;

  await fishData.set('lastFish', now);
  await fishData.set('castCount', prevCasts + 1);

  let coinLine: string;

  if (isTrash) {
    if (value < 0) {
      await currencies.decreaseMoney({
        user_id: senderID,
        money: Math.abs(value),
      });
      coinLine = `💸 Disposal fee: **${value.toLocaleString()} coins**`;
    } else {
      if (value > 0)
        await currencies.increaseMoney({ user_id: senderID, money: value });
      coinLine = `💰 Scrap value: **+${value.toLocaleString()} coins**`;
    }
  } else {
    await currencies.increaseMoney({ user_id: senderID, money: value });
    await fishData.set('totalCaught', prevCaught + 1);
    await fishData.set('totalEarned', prevEarned + value);
    coinLine = `💰 Sold for: **+${value.toLocaleString()} coins**`;
  }

  // ── Build response ────────────────────────────────────────────────────────
  const isHighValue = caught.rarity === 'rare' || caught.rarity === 'legendary';
  const header = isHighValue ? `🎉 **INCREDIBLE CATCH!**\n` : '';

  const statsLine = isTrash
    ? `📊 Total Casts: **${(prevCasts + 1).toLocaleString()}**`
    : `📊 Catches: **${(prevCaught + 1).toLocaleString()}** | Lifetime: **${(prevEarned + value).toLocaleString()} coins**`;

  const balanceButtonId = btn.generateID({
    id: BUTTON_ID.balance,
    public: false,
  });

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `${header}${caught.emoji} **${caught.name}** — ${RARITY_LABELS[caught.rarity]}`,
      ``,
      `_${caught.flavour}_`,
      ``,
      coinLine,
      statsLine,
      `⏰ Next cast available in **30 minutes**`,
    ].join('\n'),
    ...(hasNativeButtons(native.platform) ? { button: [balanceButtonId] } : {}),
  });
};
