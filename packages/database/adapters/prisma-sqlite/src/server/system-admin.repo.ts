import { prisma } from '../index.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const rows = await prisma.systemAdmin.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, adminId: r.adminId, createdAt: r.createdAt.toISOString() }));
}

export async function addSystemAdmin(adminId: string): Promise<SystemAdminItem> {
  // upsert avoids a unique-constraint error when the same adminId is registered twice
  const row = await prisma.systemAdmin.upsert({
    where: { adminId },
    create: { adminId },
    update: {},
  });
  return { id: row.id, adminId: row.adminId, createdAt: row.createdAt.toISOString() };
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  await prisma.systemAdmin.deleteMany({ where: { adminId } });
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const row = await prisma.systemAdmin.findUnique({ where: { adminId } });
  return row !== null;
}