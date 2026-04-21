import { pool } from '../client.js';

export async function getFbPageWebhookVerification(
  userId: string,
): Promise<{ isVerified: boolean } | null> {
  const res = await pool.query<{ is_verified: boolean }>(
    `SELECT is_verified FROM fb_page_webhook WHERE user_id = $1`,
    [userId],
  );
  if (!res.rows[0]) return null;
  return { isVerified: res.rows[0].is_verified };
}

export async function upsertFbPageWebhookVerification(
  userId: string,
): Promise<void> {
  // Verification status transitions false → true once and never reverts — always upsert true.
  await pool.query(
    `INSERT INTO fb_page_webhook (user_id, is_verified)
     VALUES ($1, TRUE)
     ON CONFLICT (user_id) DO UPDATE SET is_verified = TRUE`,
    [userId],
  );
}
