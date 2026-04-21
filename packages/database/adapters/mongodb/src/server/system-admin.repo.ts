import { randomUUID } from 'node:crypto';
import { getMongoDb } from '../client.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const db = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await db
    .collection<any>('systemAdmin')
    .find({})
    .sort({ createdAt: 1 })
    .toArray();
  return rows.map((r) => ({
    id: r.id as string,
    adminId: r.adminId as string,
    createdAt: (r.createdAt instanceof Date
      ? r.createdAt
      : new Date(r.createdAt as string)
    ).toISOString(),
  }));
}

export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  const db = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await db.collection<any>('systemAdmin').findOne({ adminId });
  if (existing) {
    return {
      id: existing.id as string,
      adminId: existing.adminId as string,
      createdAt: (existing.createdAt instanceof Date
        ? existing.createdAt
        : new Date(existing.createdAt as string)
      ).toISOString(),
    };
  }
  const item = { id: randomUUID(), adminId, createdAt: new Date() };
  await db.collection('systemAdmin').insertOne(item);
  return {
    id: item.id,
    adminId: item.adminId,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection('systemAdmin').deleteMany({ adminId });
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const db = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await db.collection<any>('systemAdmin').findOne({ adminId });
  return row !== null;
}
