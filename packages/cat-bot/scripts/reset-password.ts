import 'dotenv/config';
import { auth } from '../src/server/lib/better-auth.lib.js';
import readline from 'readline/promises';
import { stdin, stdout } from 'process';

// ── Usage ─────────────────────────────────────────────────────────────────────
//   npx tsx scripts/reset-password.ts [email]
//   (new password is always prompted interactively)
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  let email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) {
    email = (await rl.question('Email: ')).trim().toLowerCase();
  }

  if (!email) {
    console.error('❌ Email is required.');
    rl.close();
    process.exit(1);
  }

  const newPassword = (
    await rl.question('New password (min 8 chars): ')
  ).trim();
  rl.close();

  if (!newPassword || newPassword.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    process.exit(1);
  }

  // ── Access better-auth internal context ───────────────────────────────────
  // auth.$context is the official way to reach the internal adapter, password
  // hasher, and internalAdapter from a trusted server-side script without an
  // HTTP session. This is the same context available to hooks and plugins via
  // ctx.context — exposed as a top-level Promise on the auth instance.
  const ctx = await auth.$context;

  // ── Look up user by email ─────────────────────────────────────────────────
  // Use the raw adapter (not internalAdapter) so we can query any model field
  // directly. Emails are stored lowercase by better-auth at sign-up time.
  console.log(`\n🔍 Looking up user: ${email}`);

  type UserRecord = { id: string; email: string; name: string; role?: string };

  const user = await ctx.adapter.findOne<UserRecord>({
    model: 'user',
    where: [{ field: 'email', value: email }],
  });

  if (!user) {
    console.error(`❌ No user found with email: ${email}`);
    process.exit(1);
  }

  console.log(
    `✅ Found: ${user.name} <${user.email}> — role: ${user.role ?? 'user'}`,
  );

  // ── Hash using better-auth's configured algorithm ─────────────────────────
  // ctx.password.hash() respects whatever hashing function is set in the
  // emailAndPassword.password config (default: scrypt). This guarantees the
  // stored hash format is always what better-auth expects on sign-in — never
  // manually call Node crypto.scrypt directly, as the serialisation format
  // would diverge from the one better-auth uses internally.
  const hashed = await ctx.password.hash(newPassword);

  // ── Update the credential account row ────────────────────────────────────
  // internalAdapter.updatePassword targets the 'account' table row where
  // providerId='credential' for this userId — the same table and column that
  // sign-in reads from. Works for any role: admin, user, or custom roles.
  await ctx.internalAdapter.updatePassword(user.id, hashed);

  console.log(
    `\n🔐 Password successfully reset for ${user.email} (${user.role ?? 'user'}).`,
  );
  console.log('   The user can now sign in with the new password.');
}

main().catch((err: unknown) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});
