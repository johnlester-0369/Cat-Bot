import { prisma } from '../index.js';
import type { GetAdminUserListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const rows = await prisma.systemAdmin.findMany({
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    adminId: r.adminId,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  // upsert avoids a unique-constraint error when the same adminId is registered twice
  const row = await prisma.systemAdmin.upsert({
    where: { adminId },
    create: { adminId },
    update: {},
  });
  return {
    id: row.id,
    adminId: row.adminId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  await prisma.systemAdmin.deleteMany({ where: { adminId } });
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const row = await prisma.systemAdmin.findUnique({ where: { adminId } });
  return row !== null;
}

export async function listAllUsers(search: string = '', page: number = 1, limit: number = 10): Promise<GetAdminUserListResponseDto> {
  // SQLite handles default string matching case-insensitively behind the scenes
  const where = search ? {
    OR:[
      { name: { contains: search } },
      { email: { contains: search } },
      { role: { contains: search } }
    ]
  } : {};

  const[users, total, totalUsers, adminCount, bannedCount] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.user.count({ where: { banned: true } })
  ]);

  return {
    users: users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      banned: u.banned ?? false,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    stats: { totalUsers, adminCount, bannedCount }
  };
}
