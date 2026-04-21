import { randomUUID } from 'node:crypto';
import { pool } from '../client.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const res = await pool.query<{
    id: string;
    admin_id: string;
    created_at: Date;
  }>(
    `SELECT id, admin_id, created_at FROM system_admin ORDER BY created_at ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    adminId: r.admin_id,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  const id = randomUUID();
  // ON CONFLICT DO NOTHING returns the existing row via a follow-up SELECT — avoids two round-trips
  // on the happy path while still handling duplicate inserts gracefully.
  await pool.query(
    `INSERT INTO system_admin (id, admin_id) VALUES ($1, $2) ON CONFLICT (admin_id) DO NOTHING`,
    [id, adminId],
  );
  const res = await pool.query<{
    id: string;
    admin_id: string;
    created_at: Date;
  }>(
    `SELECT id, admin_id, created_at FROM system_admin WHERE admin_id = $1 LIMIT 1`,
    [adminId],
  );
  const row = res.rows[0];
  if (!row)
    throw new Error(
      `[system-admin] Failed to insert or find admin_id=${adminId}`,
    );
  return {
    id: row.id,
    adminId: row.admin_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  await pool.query(`DELETE FROM system_admin WHERE admin_id = $1`, [adminId]);
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM system_admin WHERE admin_id = $1 LIMIT 1`,
    [adminId],
  );
  return (res.rows[0] ?? null) !== null;
}
