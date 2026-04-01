/**
 * Users Repository — Prisma query layer for the bot_users table.
 *
 * Thin wrapper around prisma.botUser. Keeping query syntax here means:
 *   - Service files are testable by swapping the repo import without a real DB
 *   - The unique primary key (id) is centralized here
 *
 * Primary key: id
 */

import { prisma } from 'database';
import type { BotUserData } from '@/models/users.model.js';

/**
 * Creates or updates the bot_users row for a given (platform, userId) pair.
 *
 * Upsert is intentional — getInfo() calls are expensive (platform API round-trip);
 * we call once and let the row reflect the latest known state without a separate
 * read-then-write that would require a transaction.
 */
export async function upsertUser(data: BotUserData): Promise<void> {
  await prisma.botUser.upsert({
    where: {
      id: data.id,
    },
    create: data,
    // Only update the mutable profile fields; never overwrite createdAt
    update: {
      name: data.name,
      firstName: data.firstName,
      username: data.username,
      avatarUrl: data.avatarUrl,
    },
  });
}

/**
 * Returns true when a bot_users row already exists for the given (platform, userId).
 *
 * Used by on-chat.middleware to skip re-fetching users the bot has already seen.
 * Selecting only `platform` keeps the query cheap — no data transfer, index-only scan.
 */
export async function userExists(
  platform: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.botUser.findUnique({
    where: {
      id: userId,
    },
    select: { platform: true },
  });
  return row !== null;
}
