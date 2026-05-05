import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventConfig } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/utils/api.util.js';

export const config: EventConfig = {
  name: 'join',
  eventType: ['log:subscribe'],
  version: '1.0.0',
  author: 'John Lester',
  description: 'Sends a welcome message when members join the group',
};

// Random background images used across all greeting card variants
const BG_IMAGES = [
  'https://wallpapercave.com/wp/wp10776106.jpg',
  'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQk88qaiTBbD6JU0vlYMx2RjJN1V8c_bEwb5PtvQaAec7Y4_0omDCkz6BKa&s=10',
  'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQvVc1Jf79ZVQ7U7ON_cqidul0XmYGk2Ef6MXXzRdvPi_CyZ1BohTb_nXc&s=10',
  'https://wallpapercave.com/wp/wp13293206.jpg',
  'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS6uB9avkk2NQ5ZyxMIDJZUITX9AfNEz6NU2bsCt39WnvWW6Cuv7_Sb114&s=10',
];

// Accent colours cycled randomly in the welcome-pro variant
const THEMES = [
  '#6366f1',
  '#ec4899',
  '#10b981',
  '#f59e0b',
  '#3b82f6',
  '#ef4444',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Builds a random wajiro greeting image URL for a joining member.
 * Selects uniformly between three card styles; the background image
 * is independently randomised from BG_IMAGES on every call.
 */
function buildWelcomeImageUrl(opts: {
  username: string;
  avatarUrl: string;
  groupName: string;
  memberCount: number;
}): string | null {
  const { username, avatarUrl, groupName, memberCount } = opts;

  const bg = pickRandom(BG_IMAGES);

  // Pick one of the three remaining wajiro greeting styles at random (0-2)
  const variant = Math.floor(Math.random() * 3);

  switch (variant) {
    case 0:
      // Compact group card — avatar, background, member counter
      return createUrl('wajiro', '/api/v1/greetings-2', {
        type: 'welcome',
        avatar: avatarUrl,
        username,
        bg,
        groupname: groupName,
        member: String(memberCount),
      });

    case 1:
      // Minimal banner — avatar + background only
      return createUrl('wajiro', '/api/v1/greetings-3', {
        type: 'welcome',
        avatar: avatarUrl,
        username,
        bg,
      });

    case 2:
    default:
      // Pro-style card with themed colour accent
      return createUrl('wajiro', '/api/v1/welcome-pro', {
        username,
        avatar_url: avatarUrl,
        title: 'WELCOME',
        subtitle: `TO ${groupName.toUpperCase()}`,
        footer: `Member #${memberCount}`,
        theme: pickRandom(THEMES),
      });
  }
}

export const onEvent = async ({ event, chat, bot, user, thread }: AppCtx) => {
  try {
    const logMessageData = event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const added =
      (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ??
      [];

    if (!added.length) return;

    // The bot joining its own group would trigger a self-welcome — useless noise.
    // Check against bot.getID() so this guard works across all platforms without hardcoding IDs.
    const botId = await bot.getID();
    if (added.some((p) => String(p['userFbId'] ?? '') === botId)) return;

    // Prefer fullName (display name) over firstName (account handle) over ID fallback
    const getName = (p: Record<string, unknown>) =>
      String(p['fullName'] || p['firstName'] || `User ${p['userFbId']}`);

    let message: string;
    if (added.length === 1) {
      // safe fallback given the preceding length check
      message = `👋 Welcome to the group, **${getName(added[0]!)}**!`;
    } else {
      const names = added.map((p) => `• **${getName(p)}**`).join('\n');
      message = `👋 Welcome to the group!\n\n${names}`;
    }

    // ── Greeting image ────────────────────────────────────────────────────────
    // Resolve thread metadata (name, member count) for the image card.
    // We always build an image for the first (or only) joiner.
    // Run in parallel — getMemberCount hits the real-time platform API independently
    // of getInfo so Discord/Telegram get the accurate gateway/Bot-API count.
    const [threadInfo, memberCount] = await Promise.all([
      thread.getInfo().catch(() => null),
      thread.getMemberCount().catch(() => 0),
    ]);
    const groupName =
      threadInfo?.name ?? (await thread.getName().catch(() => 'the group'));

    const firstJoiner = added[0]!;
    const firstId = String(firstJoiner['userFbId'] ?? '');

    // Fallback avatar: UI Avatars generates a simple letter-based placeholder
    const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(getName(firstJoiner))}&background=random&size=256`;
    const avatarUrl =
      (await user.getAvatarUrl(firstId).catch(() => null)) ?? fallbackAvatar;

    const imageUrl = buildWelcomeImageUrl({
      username: getName(firstJoiner),
      avatarUrl,
      groupName,
      memberCount,
    });

    // Route event messaging dynamically through chat replies
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message,
      ...(imageUrl
        ? { attachment_url: [{ name: 'welcome.png', url: imageUrl }] }
        : {}),
    });
  } catch (err) {
    console.error('❌ join event handler failed:', err);
  }
};
