/**
 * Structured Logging Utility
 *
 * Centralized logging configuration using Winston with environment-aware settings.
 * Provides consistent logging across the application with proper formatting,
 * transports, and correlation ID support.
 *
 * @module utils/logger.util
 */

import winston from 'winston';
import { env } from '@/config/env.config.js';
import type { TransformableInfo } from 'logform';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended log information with optional correlation ID.
 */
export interface LogInfo extends TransformableInfo {
  timestamp?: string;
  correlationId?: string;
  [key: string]: unknown;
}

// ============================================================================
// FORMATTERS
// ============================================================================

/**
 * Development format: human-readable colored output.
 */
const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info: LogInfo) => {
    const { timestamp, level, message, correlationId, ...meta } = info;
    const metaStr =
      Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const correlationStr = correlationId ? ` [${correlationId}]` : '';
    return `${timestamp}${correlationStr} ${level}: ${message}${metaStr}`;
  }),
);

/**
 * Production format: structured JSON for log aggregation.
 */
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ============================================================================
// TRANSPORTS
// ============================================================================

/**
 * Creates console transport with environment-appropriate format.
 */
const consoleTransport = new winston.transports.Console({
  level: env.isProduction ? 'info' : env.LOG_LEVEL,
  format: env.isProduction ? prodFormat : devFormat,
  stderrLevels: ['error', 'crit', 'alert', 'emerg'],
});

/**
 * Creates file transports for production environment.
 */
const createFileTransports = () => {
  const transports = [];

  // Application log file
  if (env.LOG_FILE_PATH) {
    transports.push(
      new winston.transports.File({
        filename: env.LOG_FILE_PATH,
        level: env.LOG_LEVEL,
        format: prodFormat,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 7, // Keep 7 days of logs
      }),
    );
  }

  // Error-only log file
  if (env.ERROR_LOG_FILE_PATH) {
    transports.push(
      new winston.transports.File({
        filename: env.ERROR_LOG_FILE_PATH,
        level: 'error',
        format: prodFormat,
        maxsize: 10 * 1024 * 1024,
        maxFiles: 30, // Keep 30 days of error logs
      }),
    );
  }

  return transports;
};

// ============================================================================
// LOGGER INSTANCE
// ============================================================================

/**
 * Configured Winston logger instance.
 *
 * Features:
 * - Console logging in all environments
 * - File logging in production (if configured)
 * - Environment-specific formats (JSON for prod, colored for dev)
 * - Error stack trace capture
 * - Correlation ID support
 */
const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  transports: [
    consoleTransport,
    ...(env.isProduction ? createFileTransports() : []),
  ],
  // In development, exit on error to fail fast
  exitOnError: env.isDevelopment,
  // Silently ignore errors in file transports in production
  silent: env.isTest, // No logging during tests
});

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Main logger instance with standard methods.
 *
 * @example
 * ```typescript
 * import { logger } from '@/lib/logger.lib.js';
 *
 * logger.info('Server started', { port: 3000 });
 * logger.error('Database connection failed', { error: err });
 * ```
 */
export { logger };
