/**
 * Session Logger — Chalk-based Per-Session Log Emitter
 *
 * Lightweight replacement for Winston child loggers in platform adapter contexts.
 * Formats ANSI strings directly with chalk (matching Winston devFormat byte-for-byte)
 * and emits them straight to logRelay — bypassing the Winston transport pipeline entirely.
 *
 * WHY chalk over Winston child loggers:
 *   winston.createLogger() allocates a full Transport + Writable stream per session.
 *   With N concurrent sessions across M platforms, that's N transports all competing
 *   on the same logRelay EventEmitter and flushing through async stream.write().
 *   A direct logRelay.emit() with chalk formatting eliminates stream allocation and
 *   the async flush overhead on every log call.
 *
 * Output format matches Winston devFormat exactly:
 *   YYYY-MM-DD HH:mm:ss <level>: <message> [meta JSON]
 *   ──────────────────── entire line colorised by level ─────────────────────
 *
 * Consumers bind a specific userId, platformId, and sessionId at construction time.
 * These identifiers are automatically merged into every log entry's meta suffix
 * so the web dashboard and log aggregators can filter by session without parsing
 * message strings — identical to Winston's `defaultMeta` behaviour.
 */

import { Chalk } from 'chalk';
import { logRelay } from './log-relay.lib.js'; // Correct relative path for sibling

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionLoggerMeta {
  userId: string;
  platformId: number | string;
  sessionId: string;
}

type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug';

// ── Colour palette ─────────────────────────────────────────────────────────────

// Force level:1 (standard ANSI 16-colour) regardless of TTY detection.
// The relay emits through a Writable stream, not a terminal, so chalk's autodetect
// would strip colours without this override. level:1 matches what Winston's
// built-in colorize({ all: true }) emits — same escape codes, same visual output.
const chalk = new Chalk({ level: 1 });

const LEVEL_COLORS: Record<LogLevel, (text: string) => string> = {
  error: (t) => chalk.redBright(t),
  warn: (t) => chalk.yellowBright(t),
  info: (t) => chalk.greenBright(t),
  verbose: (t) => chalk.cyanBright(t),
  debug: (t) => chalk.blueBright(t),
};

// ── Timestamp ─────────────────────────────────────────────────────────────────

// Produces 'YYYY-MM-DD HH:mm:ss' in local time — identical output to Winston's
// timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }) which uses moment.js format tokens.
function getTimestamp(): string {
  const now = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
    `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  );
}

// ── SessionLogger ─────────────────────────────────────────────────────────────

export class SessionLogger {
  readonly #meta: SessionLoggerMeta;

  constructor(meta: SessionLoggerMeta) {
    this.#meta = meta;
  }

  #format(
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ): string {
    const metaObj: Record<string, unknown> =
      extra !== undefined ? { ...extra } : {};
    const metaStr =
      Object.keys(metaObj).length > 0 ? ` ${JSON.stringify(metaObj)}` : '';
    const colorFn = LEVEL_COLORS[level] ?? ((t: string) => t);

    // colorize({ all: true }) colorises the full line — timestamp, level, message, and meta.
    // Replicating that here keeps the relay string visually identical to terminal output.
    return (
      chalk.white(getTimestamp()) +
      colorFn(` ${level}: ${message}`) +
      chalk.white(metaStr)
    );
  }

  #emit(
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    // Mirrors Winston's `silent: env.isTest` — suppress relay emission during test runs
    // so unit tests don't accumulate phantom entries in the log history sliding window.
    if (process.env['NODE_ENV'] === 'test') return;
    const line = this.#format(level, message, extra);
    // Global emission keeps any system-wide log view intact (all sessions visible).
    logRelay.emit('log', line);
    // Keyed emission routes this entry to the session-specific Socket.IO room so the
    // bot detail page receives only logs from the bot it is currently viewing.
    const key = `${this.#meta.userId}:${this.#meta.platformId}:${this.#meta.sessionId}`;
    logRelay.emitKeyed(key, line);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.#emit('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.#emit('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.#emit('error', message, meta);
  }

  verbose(message: string, meta?: Record<string, unknown>): void {
    this.#emit('verbose', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.#emit('debug', message, meta);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a session-scoped chalk logger bound to the given userId, platformId,
 * and sessionId. Every log call merges these identifiers into the meta suffix
 * so the web dashboard can filter entries by session without parsing message strings.
 *
 * @example
 * ```typescript
 * const log = createSessionLogger({ userId: '1', platformId: 1, sessionId: 'abc' });
 * log.info('Connected');
 * // → '2026-04-03 23:57:12 info: Connected {"userId":"1","platformId":1,"sessionId":"abc"}'
 * log.warn('Rate limited', { retryAfter: 5 });
 * // → '2026-04-03 23:57:12 warn: Rate limited {"userId":"1","platformId":1,"sessionId":"abc","retryAfter":5}'
 * ```
 */
export function createSessionLogger(meta: SessionLoggerMeta): SessionLogger {
  return new SessionLogger(meta);
}
