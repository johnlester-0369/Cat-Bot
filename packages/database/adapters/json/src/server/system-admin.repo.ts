import { randomUUID } from 'node:crypto';
import { getDb, saveDb } from '../store.js';

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

export async function addSystemAdmin(adminId: string): Promise<SystemAdminItem> {
  const db = await getDb();
  // Idempotent — return existing record if adminId already registered
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (db.systemAdmin as any[]).find((r: any) => r.adminId === adminId);
  if (existing) {
    return { id: existing.id as string, adminId: existing.adminId as string, createdAt: existing.createdAt as string };
  }
  const item: SystemAdminItem = { id: randomUUID(), adminId, createdAt: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  (db.systemAdmin as any[]).push(item);
  await saveDb();
  return item;
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.systemAdmin = (db.systemAdmin as any[]).filter((r: any) => r.adminId !== adminId);
  await saveDb();
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db.systemAdmin as any[]).some((r: any) => r.adminId === adminId);
}