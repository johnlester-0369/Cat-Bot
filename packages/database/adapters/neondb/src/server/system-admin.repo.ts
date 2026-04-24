import { randomUUID } from 'node:crypto';
import { pool } from '../client.js';
import type { GetAdminUserListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';

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

export async function listAllUsers(search: string = '', page: number = 1, limit: number = 10): Promise<GetAdminUserListResponseDto> {
  const offset = (page - 1) * limit;
  let whereClause = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryParams: any[] =[];

  if (search) {
    const searchPattern = `%${search}%`;
    queryParams.push(searchPattern);
    whereClause = `WHERE name ILIKE $1 OR email ILIKE $1 OR role ILIKE $1`;
  }

  const countRes = await pool.query<{ count: string }>(`
    SELECT COUNT(*) FROM "user"
    ${whereClause}
  `, queryParams);

  const queryParamsPaginated = [...queryParams, limit, offset];
  const limitIdx = queryParamsPaginated.length - 1;
  const offsetIdx = queryParamsPaginated.length;

  const res = await pool.query<{
    id: string;
    name: string;
    email: string;
    role: string | null;
    createdAt: Date;
    banned: boolean | null;
  }>(`
    SELECT id, name, email, role, "createdAt" AS "createdAt", banned 
    FROM "user" 
    ${whereClause}
    ORDER BY "createdAt" DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `, queryParamsPaginated);

  const statsRes = await pool.query<{ total_users: string, admin_count: string, banned_count: string }>(`
    SELECT 
      COUNT(*) as total_users,
      COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
      COUNT(*) FILTER (WHERE banned = true) as banned_count
    FROM "user"
  `);

  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);
  const statsRow = statsRes.rows[0]!;

  return {
    users: res.rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      banned: r.banned ?? false,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    stats: {
      totalUsers: parseInt(statsRow.total_users, 10),
      adminCount: parseInt(statsRow.admin_count, 10),
      bannedCount: parseInt(statsRow.banned_count, 10)
    }
  };
}
