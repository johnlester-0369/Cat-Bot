/**
 * /shell — Execute Shell Commands
 *
 * Runs an arbitrary shell command on the host machine and returns stdout/stderr
 * as a formatted reply. Intended for remote server administration by system admins.
 *
 * ── Security ───────────────────────────────────────────────────────────────────
 * Restricted to Role.SYSTEM_ADMIN (level 4) — the highest privilege tier.
 * enforcePermission in on-command.middleware.ts checks isSystemAdmin() before
 * this handler ever runs, so no manual role check is needed here.
 * NEVER lower this role. Shell access equals full host machine access.
 *
 * ── Timeout ────────────────────────────────────────────────────────────────────
 * Commands that do not complete within EXEC_TIMEOUT_MS are killed and an error
 * is returned. This prevents blocking the bot process on commands like `sleep 9999`
 * or hung network calls.
 *
 * ── Output truncation ──────────────────────────────────────────────────────────
 * Platform messages have size limits (Discord: 2000 chars, Telegram: 4096 chars).
 * Output exceeding MAX_OUTPUT_CHARS is trimmed at the tail and a truncation notice
 * is appended so the user knows the output is incomplete.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────────
 *   !shell echo "Hello world"
 *   !sh ls -la /home
 *   !shell cat /etc/os-release
 *   !shell node --version
 *
 * ── Example output ─────────────────────────────────────────────────────────────
 *   $ echo "Hello world"
 *   ──────────────────
 *   Hello world
 *   ──────────────────
 *   ✅ Exit 0 · 12ms
 */

import { exec } from 'child_process';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum milliseconds to wait for a command before killing it. */
const EXEC_TIMEOUT_MS = 15_000;

/** Maximum characters of combined stdout+stderr to include in the reply. */
const MAX_OUTPUT_CHARS = 1800;

const DIVIDER = '──────────────────';

// ── Config ────────────────────────────────────────────────────────────────────

export const config = {
  name: 'shell',
  aliases: ['sh', 'bash', 'exec', 'terminal'] as string[],
  version: '1.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description:
    'Execute a shell command on the host and return its output. ' +
    'System admins only. Commands are killed after 15 seconds.',
  category: 'System',
  usage: '<command>',
  cooldown: 3,
  hasPrefix: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  elapsed: number;
}

/**
 * Wraps child_process.exec in a Promise.
 * Resolves with { stdout, stderr, code, elapsed } regardless of exit code —
 * a non-zero exit is not thrown; it is surfaced via `code` so the caller can
 * decide how to display it. Rejects only on OS-level errors (ENOMEM, ENOENT, etc.)
 * or when the process is killed by the timeout guard.
 */
function runCommand(cmd: string): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 512 /* 512 KB */ },
      (err, stdout, stderr) => {
        const elapsed = Date.now() - start;
        if (err && err.signal === 'SIGTERM') {
          reject(
            new Error(
              `Command timed out after ${EXEC_TIMEOUT_MS / 1000}s and was killed.`,
            ),
          );
          return;
        }
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: err?.code ?? 0,
          elapsed,
        });
      },
    );
  });
}

/**
 * Trims output to MAX_OUTPUT_CHARS and appends a truncation notice when needed.
 * Preserves a trailing newline so the notice reads on its own line.
 */
function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return (
    text.slice(0, MAX_OUTPUT_CHARS) +
    `\n… [truncated — ${text.length - MAX_OUTPUT_CHARS} chars omitted]`
  );
}

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async ({
  args,
  chat,
  usage,
  prefix = '',
}: AppCtx): Promise<void> => {
  // args is a string[] — rejoin with spaces to reconstruct the raw command string.
  const cmd = args.join(' ').trim();

  if (!cmd) {
    await usage();
    return;
  }

  // Loading indicator — shell commands can be slow; the user deserves feedback
  // before the 15-second timeout arrives.
  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `⚙️ Running: \`${cmd}\``,
  })) as string | undefined;

  try {
    const { stdout, stderr, code, elapsed } = await runCommand(cmd);

    // Combine stdout + stderr — both are useful; stdout first, stderr after.
    const raw = [stdout, stderr].filter(Boolean).join('\n');
    const output = raw ? truncate(raw) : '_(no output)_';

    const statusIcon = code === 0 ? '✅' : '❌';
    const statusLine = `${statusIcon} Exit ${code} · ${elapsed}ms`;

    const message = [`\`$ ${cmd}\``, DIVIDER, output, DIVIDER, statusLine].join(
      '\n',
    );

    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message,
    });
  } catch (err) {
    const error = err as { message?: string };
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ **Shell error**\n` +
        DIVIDER +
        '\n' +
        `\`${error.message ?? 'Unknown error'}\`\n` +
        DIVIDER +
        '\n' +
        `_Tip: use \`${prefix}shell echo test\` to verify connectivity._`,
    });
  }
};
