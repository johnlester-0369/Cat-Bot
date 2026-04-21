import { prisma } from '../index.js';

export async function getFbPageWebhookVerification(
  userId: string,
): Promise<{ isVerified: boolean } | null> {
  return prisma.fbPageWebhook.findUnique({
    where: { userId },
    select: { isVerified: true },
  });
}

export async function upsertFbPageWebhookVerification(
  userId: string,
): Promise<void> {
  await prisma.fbPageWebhook.upsert({
    where: { userId },
    create: { userId, isVerified: true },
    update: { isVerified: true },
  });
}
