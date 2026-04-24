import { randomUUID } from 'node:crypto';
import { getDb, saveDb } from '../store.js';
import type { GetAdminUserListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
  return (db.systemAdmin as any[]).map((r: any) => ({
    id: r.id as string,
    adminId: r.adminId as string,
    createdAt: r.createdAt as string,
  }));
}

export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  const db = await getDb();
  // Idempotent — return existing record if adminId already registered
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (db.systemAdmin as any[]).find(
    (r: any) => r.adminId === adminId,
  );
  if (existing) {
    return {
      id: existing.id as string,
      adminId: existing.adminId as string,
      createdAt: existing.createdAt as string,
    };
  }
  const item: SystemAdminItem = {
    id: randomUUID(),
    adminId,
    createdAt: new Date().toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  (db.systemAdmin as any[]).push(item);
  await saveDb();
  return item;
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.systemAdmin = (db.systemAdmin as any[]).filter(
    (r: any) => r.adminId !== adminId,
  );
  await saveDb();
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db.systemAdmin as any[]).some((r: any) => r.adminId === adminId);
}

export async function listAllUsers(search: string = '', page: number = 1, limit: number = 10): Promise<GetAdminUserListResponseDto> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allUsers = (db.user ||[]).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role ?? null,
    createdAt: new Date(u.createdAt as string).toISOString(),
    banned: u.banned ?? false,
  }));

  const searchLower = search.trim().toLowerCase();
  // Handle case-insensitive array filtering explicitly since JSON adapters lack real indices 
  const filtered = searchLower ? allUsers.filter((u: any) =>
    (u.name || '').toLowerCase().includes(searchLower) ||
    (u.email || '').toLowerCase().includes(searchLower) ||
    (u.role || '').toLowerCase().includes(searchLower)
  ) : allUsers;

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  const stats = {
    totalUsers: allUsers.length,
    adminCount: allUsers.filter((u: any) => u.role === 'admin').length,
    bannedCount: allUsers.filter((u: any) => u.banned).length
  };

  return { users: paginated, total, page, limit, totalPages, stats };
}
