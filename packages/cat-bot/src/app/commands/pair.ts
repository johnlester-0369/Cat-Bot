// /pair — Compatibility Pairing
//
// Pairs two users and generates a compatibility card via the
// Wajiro /api/v1/pair endpoint.
//
// Targeting modes (in priority order):
//   Modes: @user1 @user2 | reply | @mention | uid | me | (none)
//
// Gender filtering (random and me modes only):
//   Candidates are resolved via ctx.user.getInfo() which carries the platform
//   raw user object. For Facebook Messenger (fca-unofficial) the gender field
//   is present on the raw object: 2 = male, 1 = female, 0 = unknown.
//   When gender cannot be determined for enough candidates the command falls
//   back to unrestricted random selection and notifies the user.
//
// Deleted/disabled account filtering:
//   Candidates whose resolved name matches known platform tombstone strings
//   ("Facebook User", "Deleted Account") or who have no avatar are excluded.
//
// Platform restriction: Discord, Telegram, Facebook Messenger only.
// Cooldown: 60 seconds.

import type { AppCtx } from '@/engine/types/controller.types.js';
import type { UserContext } from '@/engine/adapters/models/interfaces/index.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/utils/api.util.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'pair',
  aliases: ['ship', 'compatibility'],
  version: '2.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Pair two users and reveal their compatibility percentage as an image card.',
  category: 'Fun',
  usage: [
    '@user1 @user2  <- ships the two mentioned users together',
    '(reply)        <- pairs you with the user you replied to',
    '@mention       <- pairs you with the mentioned user',
    '<uid>          <- pairs you with a user by their ID',
    'me             <- pairs you with a random group member (opposite gender)',
    '(none)         <- randomly pairs two members of opposite gender',
  ],
  cooldown: 60,
  hasPrefix: true,
  platform: [
    Platforms.Discord,
    Platforms.Telegram,
    Platforms.FacebookMessenger,
  ],
};

// ── Gender types and helpers ──────────────────────────────────────────────────

type Gender = 'male' | 'female' | 'unknown';

// Maximum number of participants to resolve full profiles for during random
// candidate search. Keeps API calls bounded for large groups.
const MAX_PROFILE_FETCH = 50;

// Known platform tombstone display names for deleted or disabled accounts.
const DELETED_NAMES = new Set([
  'facebook user',
  'deleted account',
  'unknown user',
  'ghost',
]);

// Parses the gender value returned by platform adapters.
// fca-unofficial: 2 = male, 1 = female, 0 = unknown.
// Some adapters may return string values ("MALE", "FEMALE").
function parseGender(value: unknown): Gender {
  if (typeof value === 'number') {
    if (value === 2) return 'male';
    if (value === 1) return 'female';
    return 'unknown';
  }
  if (typeof value === 'string') {
    const g = value.toLowerCase().trim();
    if (g === 'male' || g === 'm' || g === '2') return 'male';
    if (g === 'female' || g === 'f' || g === '1') return 'female';
  }
  return 'unknown';
}

interface UserProfile {
  id: string;
  name: string;
  gender: Gender;
  isDeleted: boolean;
}

// Resolves a single user's profile — gender and deleted status.
// Accesses platform-specific fields via type assertion since UnifiedUserInfo
// only defines the cross-platform minimum; fca raw object carries gender.
async function resolveProfile(
  userID: string,
  user: UserContext,
): Promise<UserProfile> {
  try {
    const info = await user.getInfo(userID);
    const loose = info as unknown as Record<string, unknown>;

    // Try gender from the top-level info object first (some adapters hoist it),
    // then fall back to the nested raw platform object.
    const rawObj = loose['raw'] as Record<string, unknown> | undefined;
    const genderRaw = loose['gender'] ?? rawObj?.['gender'];
    const gender = parseGender(genderRaw);

    const nameLower = info.name.toLowerCase().trim();
    const isDeleted =
      DELETED_NAMES.has(nameLower) || info.avatarUrl === null;

    return { id: userID, name: info.name, gender, isDeleted };
  } catch {
    return { id: userID, name: userID, gender: 'unknown', isDeleted: false };
  }
}

// Resolves profiles for a batch of user IDs in parallel.
async function resolveProfiles(
  ids: string[],
  user: UserContext,
): Promise<UserProfile[]> {
  return Promise.all(ids.map((id) => resolveProfile(id, user)));
}

// ── Compatibility scorer ──────────────────────────────────────────────────────

// Deterministic djb2-style hash clamped to [74, 99].
// Commutative: pair(A, B) === pair(B, A) via sorted join.
function computeCompatibility(idA: string, idB: string): number {
  const seed = [idA, idB].sort().join(':');
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (((hash << 5) + hash) ^ seed.charCodeAt(i)) >>> 0;
  }
  return 74 + (hash % 26);
}

// ── Shuffle helper ────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickOne<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Command handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  user,
  thread,
  event,
  args,
  usage,
}: AppCtx): Promise<void> => {
  // ── Group guard ─────────────────────────────────────────────────────────────
  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  const senderID   = event['senderID'] as string;
  const threadID   = event['threadID'] as string;
  const mentions   = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});

  const messageReply    = event['messageReply'] as Record<string, unknown> | undefined;
  const repliedSenderID = (messageReply?.['senderID'] as string | undefined) ?? null;

  // ── Fetch thread participants (needed for random/me modes) ──────────────────
  let participants: string[] = [];
  const needsParticipants =
    mentionIDs.length < 2 &&
    !repliedSenderID &&
    (mentionIDs.length === 0) &&
    (!args[0] || args[0].toLowerCase() === 'me');

  if (needsParticipants) {
    try {
      const info = await thread.getInfo(threadID);
      participants = info.participantIDs ?? [];
    } catch {
      // Fall through — empty participants triggers the error below
    }
  }

  // ── Resolve pairs ───────────────────────────────────────────────────────────

  let userID1: string;
  let userID2: string;
  let overrideName1: string | null = null;
  let overrideName2: string | null = null;
  let genderFilterWarning = false;

  // ── Mode 0: double mention — ship the two tagged users ─────────────────────
  if (mentionIDs.length >= 2) {
    userID1 = mentionIDs[0]!;
    userID2 = mentionIDs[1]!;
    overrideName1 = (mentions?.[userID1] ?? '').replace(/^@/, '').trim() || null;
    overrideName2 = (mentions?.[userID2] ?? '').replace(/^@/, '').trim() || null;
  }

  // ── Mode 1: reply — pair sender with the replied-to user ───────────────────
  else if (repliedSenderID) {
    userID1 = senderID;
    userID2 = repliedSenderID;
  }

  // ── Mode 2: single mention — pair sender with the mentioned user ────────────
  else if (mentionIDs.length === 1) {
    userID1 = senderID;
    userID2 = mentionIDs[0]!;
    overrideName2 = (mentions?.[userID2] ?? '').replace(/^@/, '').trim() || null;
  }

  // ── Mode 3: UID arg ─────────────────────────────────────────────────────────
  else if (args[0] && args[0].toLowerCase() !== 'me') {
    userID1 = senderID;
    userID2 = args[0].trim();
  }

  // ── Mode 4: /pair me — sender + random opposite-gender participant ──────────
  else if (args[0]?.toLowerCase() === 'me') {
    const senderProfile = await resolveProfile(senderID, user);
    const opposite: Gender =
      senderProfile.gender === 'male'
        ? 'female'
        : senderProfile.gender === 'female'
        ? 'male'
        : 'unknown';

    const candidateIDs = shuffle(
      participants.filter((id) => id !== senderID),
    ).slice(0, MAX_PROFILE_FETCH);

    if (candidateIDs.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ No other participants found to pair you with.',
      });
      return;
    }

    const profiles = await resolveProfiles(candidateIDs, user);
    const valid = profiles.filter((p) => !p.isDeleted);

    // Try opposite gender first; fall back to any valid candidate
    const gendered = opposite !== 'unknown'
      ? valid.filter((p) => p.gender === opposite)
      : [];

    const partner = pickOne(gendered) ?? pickOne(valid);

    if (gendered.length === 0 && valid.length > 0) genderFilterWarning = true;

    if (!partner) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ No eligible participants found to pair you with.',
      });
      return;
    }

    userID1 = senderID;
    userID2 = partner.id;
  }

  // ── Mode 5: fully random — two opposite-gender participants ─────────────────
  else {
    const candidateIDs = shuffle(
      participants.filter((id) => id !== senderID),
    ).slice(0, MAX_PROFILE_FETCH);

    if (participants.length < 2 || candidateIDs.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Not enough participants found to pair randomly. Try mentioning someone.',
      });
      return;
    }

    const profiles = await resolveProfiles(candidateIDs, user);
    const valid = profiles.filter((p) => !p.isDeleted);

    const males   = valid.filter((p) => p.gender === 'male');
    const females = valid.filter((p) => p.gender === 'female');

    let picked1: UserProfile | undefined;
    let picked2: UserProfile | undefined;

    if (males.length > 0 && females.length > 0) {
      // Ideal path: one from each gender
      picked1 = pickOne(males)!;
      picked2 = pickOne(females)!;
    } else {
      // Fallback: not enough gendered data — pick any two distinct valid users
      genderFilterWarning = true;
      const shuffled = shuffle(valid);
      picked1 = shuffled[0];
      picked2 = shuffled[1];
    }

    if (!picked1 || !picked2) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Not enough eligible participants found. Try mentioning someone instead.',
      });
      return;
    }

    // Randomly assign which user goes to which slot
    if (Math.random() < 0.5) {
      userID1 = picked1.id;
      userID2 = picked2.id;
    } else {
      userID1 = picked2.id;
      userID2 = picked1.id;
    }
  }

  // ── Self-pair guard ─────────────────────────────────────────────────────────
  if (userID1 === userID2) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ You cannot pair a user with themselves.',
    });
    return;
  }

  // ── Resolve names and avatars ───────────────────────────────────────────────
  try {
    const [resolvedName1, resolvedName2] = await Promise.all([
      user.getName(userID1),
      user.getName(userID2),
    ]);
    const name1 = overrideName1 ?? resolvedName1 ?? userID1;
    const name2 = overrideName2 ?? resolvedName2 ?? userID2;

    const [avatarUrl1, avatarUrl2] = await Promise.all([
      user.getAvatarUrl(userID1),
      user.getAvatarUrl(userID2),
    ]);

    if (!avatarUrl1 || !avatarUrl2) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Could not retrieve one or both profile pictures. Please try again.',
      });
      return;
    }

    // ── Compute score and call API ────────────────────────────────────────────
    const compatibility = computeCompatibility(userID1, userID2);

    const apiUrl = createUrl('wajiro', '/api/v1/pair');
    if (!apiUrl) throw new Error('Failed to build Wajiro API URL.');

    const form = new FormData();
    form.append('avatar1', avatarUrl1);
    form.append('avatar2', avatarUrl2);
    form.append('name1', name1);
    form.append('name2', name2);
    form.append('compatibility', String(compatibility));

    const res = await fetch(apiUrl, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Wajiro API returned status ${res.status}`);

    const imageBuffer = Buffer.from(await res.arrayBuffer());

    const caption = buildCaption(name1, name2, compatibility, genderFilterWarning);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [{ name: 'pair.png', stream: imageBuffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Something went wrong. Please try again.'}`,
    });
  }
};

// ── Caption helpers ───────────────────────────────────────────────────────────

function buildCaption(
  name1: string,
  name2: string,
  score: number,
  genderWarning: boolean,
): string {
  const lines = [
    `${heartEmoji(score)} **${name1}** x **${name2}**`,
    `Compatibility: **${score}%** — ${compatLabel(score)}`,
  ];
  if (genderWarning) {
    lines.push(
      '_Note: gender info was unavailable, so the pair was chosen at random._',
    );
  }
  return lines.join('\n');
}

function heartEmoji(score: number): string {
  if (score >= 95) return '💖';
  if (score >= 88) return '💗';
  if (score >= 80) return '💛';
  return '💙';
}

function compatLabel(score: number): string {
  if (score >= 95) return 'A match made in heaven! 🌟';
  if (score >= 88) return 'Practically soulmates 💫';
  if (score >= 80) return 'Really great together!';
  return "There's definitely something there ✨";
}