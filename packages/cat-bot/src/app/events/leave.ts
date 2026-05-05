import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventConfig } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/utils/api.util.js';

export const config: EventConfig = {
  name: 'leave',
  eventType: ['log:unsubscribe'],
  version: '1.0.0',
  author: 'John Lester',
  description: 'Sends a goodbye message when members leave the group',
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
 * Builds a random wajiro goodbye image URL for a departing member.
 * Selects uniformly between three card styles; the background image
 * is independently randomised from BG_IMAGES on every call.
 */
function buildGoodbyeImageUrl(opts: {
  username: string;
  avatarUrl: string;
  groupName: string;
  memberCount: number;
  wasRemoved: boolean;
}): string | null {
  const { username, avatarUrl, groupName, memberCount, wasRemoved } = opts;

  const bg = pickRandom(BG_IMAGES);

  // Pick one of the three remaining wajiro greeting styles at random (0-2)
  const variant = Math.floor(Math.random() * 3);

  switch (variant) {
    case 0:
      // Compact group card — avatar, background, member counter
      return createUrl('wajiro', '/api/v1/greetings-2', {
        type: 'goodbye',
        avatar: avatarUrl,
        username,
        bg,
        groupname: groupName,
        member: String(memberCount),
      });

    case 1:
      // Minimal banner — avatar + background only
      return createUrl('wajiro', '/api/v1/greetings-3', {
        type: 'goodbye',
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
        title: wasRemoved ? 'REMOVED' : 'GOODBYE',
        subtitle: `FROM ${groupName.toUpperCase()}`,
        footer: `${memberCount} member${memberCount !== 1 ? 's' : ''} remaining`,
        theme: pickRandom(THEMES),
      });
  }
}

export const onEvent = async ({ event, chat, bot, user, thread }: AppCtx) => {
  try {
    const logMessageData = event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const logMessageBody = event['logMessageBody'] as string | undefined;
    const author = event['author'] as string | undefined;

    const leftId = String(logMessageData?.['leftParticipantFbId'] ?? '');

    // The bot leaving or being removed from a group would send a departure message into
    // a thread it can no longer reach — pointless and likely to cause a delivery error.
    const botId = await bot.getID();
    if (leftId === botId) return;

    // wasRemoved: the author is someone other than the person who left.
    // fca provides a real author ID; Discord/Telegram normalizers always emit '' so wasRemoved = false.
    const wasRemoved = Boolean(author && author !== leftId);

    // Prefer logMessageBody when available — fca provides human-readable descriptions
    // (e.g. "Scarlet Smith left the group." / "Elle removed Scarlet from the group.").
    // Discord and Telegram wrappers also construct logMessageBody for consistency.
    const message = logMessageBody
      ? `👋 ${logMessageBody}`
      : wasRemoved
        ? '👋 **A member has been removed** from the group.'
        : '👋 **A member has left** the group.';

    // ── Goodbye image ─────────────────────────────────────────────────────────
    // Resolve thread metadata and the departing member's avatar for the image card.
    const threadInfo = await thread.getInfo().catch(() => null);
    const groupName =
      threadInfo?.name ?? (await thread.getName().catch(() => 'the group'));
    const memberCount =
      threadInfo?.memberCount ?? threadInfo?.participantIDs.length ?? 0;

    // Attempt to resolve the departing member's display name from the DB / platform
    const leftName = leftId
      ? await user.getName(leftId).catch(() => 'A member')
      : 'A member';

    // Fallback avatar: UI Avatars generates a simple letter-based placeholder
    const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(leftName)}&background=random&size=256`;
    const avatarUrl =
      (leftId
        ? await user.getAvatarUrl(leftId).catch(() => null)
        : null) ?? fallbackAvatar;

    const imageUrl = buildGoodbyeImageUrl({
      username: leftName,
      avatarUrl,
      groupName,
      memberCount,
      wasRemoved,
    });

    // Send through conversational context to respect threading scopes
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message,
      ...(imageUrl
        ? { attachment_url: [{ name: 'goodbye.png', url: imageUrl }] }
        : {}),
    });
  } catch (err) {
    console.error('❌ leave event handler failed:', err);
  }
};