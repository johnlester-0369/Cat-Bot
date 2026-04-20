/**
 * /work — Hourly Work Reward Command
 *
 * Performs a random job once per hour and earns coins.
 * Each job has a unique pay range; outcome is randomly selected within that range.
 * A small chance of a mishap reduces earnings to avoid trivial farming.
 *
 * Collection schema (stored under the "work" key in bot_users_session.data):
 *   {
 *     lastWork:    number  — Unix timestamp (ms) of the last work attempt
 *     totalEarned: number  — lifetime coins earned from working
 *     jobCount:    number  — total number of times the user has worked
 *   }
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';

export const config = {
  name: 'work',
  aliases: ['job', 'earn'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Work a random job and earn coins once per hour.',
  category: 'Economy',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/** 1-hour cooldown between work attempts. */
const COOLDOWN_MS = 60 * 60 * 1000;

/** Chance (0–1) of a mishap occurring, reducing the payout. */
const MISHAP_CHANCE = 0.12;

/** Multiplier applied to base pay when a mishap occurs. */
const MISHAP_PENALTY = 0.4;

// ── Job Definitions ───────────────────────────────────────────────────────────

interface Job {
  title: string;
  emoji: string;
  /** [min, max] coin range for a normal outcome. */
  pay: [number, number];
  actions: string[];
  mishaps: string[];
}

const JOBS: Job[] = [
  {
    title: 'Software Developer',
    emoji: '💻',
    pay: [180, 380],
    actions: [
      'You shipped a critical bug fix and the client was thrilled.',
      'You refactored legacy spaghetti code into clean modules.',
      'You built a REST endpoint that the team had been waiting weeks for.',
      'You pair-programmed with a junior and reviewed three PRs.',
    ],
    mishaps: [
      "You accidentally deleted the production database. It's recoverable, but the mood is not.",
      "You spent 2 hours debugging only to find it was a missing semicolon.",
    ],
  },
  {
    title: 'Street Chef',
    emoji: '🍳',
    pay: [120, 260],
    actions: [
      'Your lunchtime special sold out in 40 minutes.',
      'A food critic gave you a glowing anonymous review online.',
      'You perfected a new recipe that has regulars coming back daily.',
      'The morning rush went flawlessly and tips were generous.',
    ],
    mishaps: [
      'You burned the entire batch of garlic bread and had to comp three tables.',
      'The gas ran out mid-service. Awkward all around.',
    ],
  },
  {
    title: 'Delivery Driver',
    emoji: '🛵',
    pay: [100, 230],
    actions: [
      'You completed 12 deliveries with zero complaints.',
      'A customer gave you a 5-star tip for arriving early.',
      'You navigated traffic like a professional and broke your personal record.',
      'A rainy night meant surge pricing — your wallet appreciated it.',
    ],
    mishaps: [
      'A flat tire cost you two hours and three deliveries.',
      'You delivered to the wrong address. The customer was… understanding.',
    ],
  },
  {
    title: 'Freelance Artist',
    emoji: '🎨',
    pay: [60, 420],
    actions: [
      'A client commissioned a full digital portrait at a premium rate.',
      'Your latest piece went mildly viral on social media — commissions poured in.',
      'You completed a logo redesign ahead of schedule and got a bonus.',
      'A gallery expressed interest in your portfolio.',
    ],
    mishaps: [
      'Your drawing tablet driver crashed and you lost two hours of work.',
      "A client disputed the invoice. You settled for less, but it's over.",
    ],
  },
  {
    title: 'Security Guard',
    emoji: '🛡️',
    pay: [130, 210],
    actions: [
      'You stopped a shoplifter before they made it out the door.',
      'A quiet double shift with no incidents — steady pay, easy night.',
      'Management complimented your professional demeanour during an incident.',
      'You helped a lost child find their parents and received public praise.',
    ],
    mishaps: [
      'You fell asleep at the post for 20 minutes. Nothing happened, but your supervisor noticed.',
      "You locked yourself out of the security room. The manager wasn't amused.",
    ],
  },
  {
    title: 'Barista',
    emoji: '☕',
    pay: [80, 175],
    actions: [
      'The morning rush was relentless but you kept every order accurate.',
      'A regular praised your latte art to the entire café.',
      'You upsold a dozen pastries before noon.',
      'You trained a new hire and your manager noticed your leadership.',
    ],
    mishaps: [
      'You spilled an entire pot of espresso on the counter.',
      'You mixed up a decaf and a regular — the customer came back very upset.',
    ],
  },
  {
    title: 'Mechanic',
    emoji: '🔧',
    pay: [150, 320],
    actions: [
      'You diagnosed and fixed a transmission issue that had stumped three other shops.',
      'You serviced five vehicles before lunch — a personal record.',
      'A long-time client recommended you to their entire neighbourhood.',
      'You sourced a rare part online and completed the job ahead of schedule.',
    ],
    mishaps: [
      'A bolt stripped during reassembly. An extra hour and some colourful language later, it was done.',
      "You ordered the wrong part. The client wasn't thrilled about the delay.",
    ],
  },
  {
    title: 'Nurse',
    emoji: '🩺',
    pay: [200, 400],
    actions: [
      'You managed a busy ward and received a heartfelt thank-you from a patient.',
      'You caught a medication error before it reached the patient.',
      'You comforted a nervous family and the attending physician complimented your care.',
      'A triple shift — exhausting, but the overtime is reflected in your pay.',
    ],
    mishaps: [
      "The hospital system crashed mid-shift. Paper charts for everyone — your handwriting isn't great.",
      'A supply delivery was wrong and you spent an hour sorting the stockroom.',
    ],
  },
  {
    title: 'Music Teacher',
    emoji: '🎵',
    pay: [110, 240],
    actions: [
      'A student nailed the piece they had been struggling with for weeks.',
      'You taught three private lessons back-to-back and all went smoothly.',
      'A parent enrolled two siblings after watching their child perform.',
      'Your recital prep session went better than expected.',
    ],
    mishaps: [
      'A student cancelled last-minute without notice — unpaid gap in your schedule.',
      "The school piano is badly out of tune. You spent half the lesson explaining why it sounds wrong.",
    ],
  },
  {
    title: 'Streamer',
    emoji: '🎮',
    pay: [40, 500],
    actions: [
      'A clip you made went viral and your subscriber count jumped overnight.',
      'You hit a personal concurrent-viewer record during your stream.',
      'A generous donation came in during a clutch play.',
      'A sponsor reached out after seeing your latest content.',
    ],
    mishaps: [
      'Your stream froze right at the best moment. The chat was not forgiving.',
      'You went live on the wrong account. Classic.',
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

const pad = (n: number): string => String(n).padStart(2, '0');

function formatRemaining(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${h}h ${pad(m)}m ${pad(s)}s`;
}

// ── Button Definitions ────────────────────────────────────────────────────────

const BUTTON_ID = { balance: 'balance' } as const;

export const button = {
  [BUTTON_ID.balance]: {
    label: '💰 My Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, currencies }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) return;
      const coins = await currencies.getMoney(senderID);
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: `💰 **Current Balance:** ${coins.toLocaleString()} coins`,
        ...(hasNativeButtons(native.platform)
          ? { button: [event['buttonID'] as string] }
          : {}),
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

  if (!(await userColl.isCollectionExist('work'))) {
    await userColl.createCollection('work');
  }

  const workData = await userColl.getCollection('work');
  const lastWork = (await workData.get('lastWork')) as number | undefined;
  const now = Date.now();

  // ── Cooldown check ────────────────────────────────────────────────────────
  if (lastWork !== undefined && now - lastWork < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - (now - lastWork);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        "⏰ You're still tired from your last shift!",
        `Rest up — you can work again in **${formatRemaining(remaining)}**`,
      ].join('\n'),
    });
    return;
  }

  // ── Pick a random job and compute earnings ────────────────────────────────
  const job = pick(JOBS);
  const hasMishap = Math.random() < MISHAP_CHANCE;
  const basePay = randInt(job.pay[0], job.pay[1]);
  const earned = hasMishap ? Math.floor(basePay * MISHAP_PENALTY) : basePay;
  const narrative = hasMishap ? pick(job.mishaps) : pick(job.actions);

  // ── Persist state ─────────────────────────────────────────────────────────
  const prevTotal = ((await workData.get('totalEarned')) as number | undefined) ?? 0;
  const prevCount = ((await workData.get('jobCount')) as number | undefined) ?? 0;

  await workData.set('lastWork', now);
  await workData.set('totalEarned', prevTotal + earned);
  await workData.set('jobCount', prevCount + 1);
  await currencies.increaseMoney({ user_id: senderID, money: earned });

  // ── Build response ────────────────────────────────────────────────────────
  const mishapLine = hasMishap
    ? `\n⚠️ _Mishap! You only earned a fraction of your usual pay._`
    : '';

  const balanceButtonId = btn.generateID({ id: BUTTON_ID.balance, public: false });

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `${job.emoji} **${job.title}**`,
      ``,
      `_${narrative}_`,
      ``,
      `💰 Earned: **+${earned.toLocaleString()} coins**${mishapLine}`,
      `📊 Total Jobs: **${(prevCount + 1).toLocaleString()}** | Lifetime: **${(prevTotal + earned).toLocaleString()} coins**`,
      `⏰ Next shift available in **1 hour**`,
    ].join('\n'),
    ...(hasNativeButtons(native.platform) ? { button: [balanceButtonId] } : {}),
  });
};