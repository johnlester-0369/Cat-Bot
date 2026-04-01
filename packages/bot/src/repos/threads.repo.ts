/**
 * Threads Repository — Prisma query layer for the bot_threads table.
 *
 * Thin wrapper around prisma.botThread. Maps participants arrays to standard
 * Prisma many-to-many implicit relationship syntax (connect and set).
 *
 * Primary key: id
 */

import { prisma } from 'database';
import type { BotThreadData } from '@/models/threads.model.js';

/**
 * Creates or updates the bot_threads row for a given (platform, threadId) pair.
 *
 * Participant and admin ID arrays are overwritten on each upsert so the row stays
 * consistent with the platform's current member list (e.g. after kicks or joins).
 */
export async function upsertThread(data: BotThreadData): Promise<void> {
  const allUserIds = Array.from(
    new Set([...data.participantIDs, ...data.adminIDs]),
  );

  // Prisma v7's prisma-client provider removed skipDuplicates from createMany — passing it
  // throws PrismaClientValidationError. Replicate the same skip-duplicates semantics:
  // fetch which IDs already exist, then insert only the missing ones so that real profile
  // data already synced by syncUsers() is never overwritten by these placeholder rows.
  if (allUserIds.length > 0) {
    const existing = await prisma.botUser.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((u) => u.id));
    const toCreate = allUserIds
      .filter((id) => !existingIds.has(id))
      .map((id) => ({ platform: data.platform, id, name: 'Unknown User' }));

    if (toCreate.length > 0) {
      await prisma.botUser.createMany({ data: toCreate });
    }
  }

  const participantConnects = data.participantIDs.map((id) => ({ id }));
  const adminConnects = data.adminIDs.map((id) => ({ id }));

  await prisma.botThread.upsert({
    where: {
      id: data.id,
    },
    create: {
      platform: data.platform,
      id: data.id,
      name: data.name,
      isGroup: data.isGroup,
      memberCount: data.memberCount,
      avatarUrl: data.avatarUrl,
      participants: { connect: participantConnects },
      admins: { connect: adminConnects },
    },
    update: {
      name: data.name,
      isGroup: data.isGroup,
      memberCount: data.memberCount,
      avatarUrl: data.avatarUrl,
      // Use set to fully replace existing relational arrays with current snapshot
      participants: { set: participantConnects },
      admins: { set: adminConnects },
    },
  });
}

/**
 * Returns true when a bot_threads row already exists for the given (platform, threadId).
 *
 * Selecting only `platform` keeps the query cheap; used by on-chat.middleware to decide
 * whether a full platform API round-trip is needed.
 */
export async function threadExists(
  platform: string,
  threadId: string,
): Promise<boolean> {
  const row = await prisma.botThread.findUnique({
    where: {
      id: threadId,
    },
    select: { platform: true },
  });
  return row !== null;
}
