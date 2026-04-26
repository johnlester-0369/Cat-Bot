/**
 * Environment Configuration Module
 *
 * Centralized, type-safe environment variable management with runtime validation.
 * Fails fast on missing required variables - validates on import.
 *
 * @module config/env.config.ts
 */
import 'dotenv/config';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Valid Node environment values.
 * Strictly typed to prevent runtime errors from invalid environment strings.
 */
export type NodeEnv = 'development' | 'production' | 'test';

/**
 * Environment configuration type definition.
 * IMPORTANT: With exactOptionalPropertyTypes: true, optional properties
 * must explicitly include undefined in their type.
 */
interface EnvConfig {
  // Core application settings
  readonly NODE_ENV: NodeEnv;
  readonly PORT: string;

  // Logging configuration
  readonly LOG_LEVEL: string;
  readonly LOG_FILE_PATH?: string | undefined;
  readonly ERROR_LOG_FILE_PATH?: string | undefined;
  // Telegram transport — bare HTTPS domain routes webhook mode; absent = long-polling fallback
  readonly TELEGRAM_WEBHOOK_DOMAIN?: string | undefined;
  // Validates X-Telegram-Bot-Api-Secret-Token on every incoming webhook request (Bot API 7.0+).
  // Telegraf registers this with Telegram via setWebhook; requests missing or mismatching the header are rejected before any handler runs.
  readonly TELEGRAM_WEBHOOK_SECRET_TOKEN?: string | undefined;

  // Database
  readonly DATABASE_TYPE?: string | undefined;

  // Bot Management API / Web
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_URL?: string | undefined;
  readonly VITE_URL?: string | undefined;
  readonly VITE_EMAIL_SERVICES_ENABLE?: string | undefined;

  // Gmail SMTP — optional; when absent mailer.lib.ts skips email delivery and logs a warning.
  // Both vars must be set together: GMAIL_USER is the sender address, GOOGLE_APP_PASSWORD
  // is the 16-character App Password generated at myaccount.google.com → Security → App Passwords.
  readonly GMAIL_USER?: string | undefined;
  readonly GOOGLE_APP_PASSWORD?: string | undefined;

  // Security
  readonly ENCRYPTION_KEY: string;
  /**
   * Groq API key for AI-powered commands (ai, agent). Optional — bot
   * starts normally when absent but AI features will gracefully reject.
   */
  readonly GROQ_API_KEY?: string | undefined;

  // Derived boolean helpers
  readonly isDevelopment: boolean;
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Valid NODE_ENV values as a readonly for validation.
 */
const VALID_NODE_ENVS: readonly NodeEnv[] = [
  'development',
  'production',
  'test',
] as const;

/**
 * Valid log levels for winston.
 */
const VALID_LOG_LEVELS = [
  'error',
  'warn',
  'info',
  'http',
  'verbose',
  'debug',
  'silly',
] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Retrieves a required environment variable.
 * @param key - Environment variable key
 * @returns Environment variable value
 * @throws {Error} If the variable is missing or empty
 */
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(
      `[ENV] Missing required environment variable: ${key}\n` +
        `Please check your .env file or environment configuration`,
    );
  }
  return value;
}

/**
 * Retrieves an optional environment variable.
 * @param key - Environment variable key
 * @returns Environment variable value or undefined
 */
function getOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === '' ? undefined : value;
}

/**
 * Retrieves and validates NODE_ENV environment variable.
 * @returns Validated NodeEnv value
 * @throws {Error} If NODE_ENV is missing or not a valid value
 */
function getNodeEnv(): NodeEnv {
  const value = process.env.NODE_ENV;
  if (value === undefined || value === '') {
    throw new Error(
      `[ENV] Missing required environment variable: NODE_ENV\n` +
        `Valid values are: ${VALID_NODE_ENVS.join(', ')}\n` +
        `Please check your .env file or environment configuration`,
    );
  }
  if (!VALID_NODE_ENVS.includes(value as NodeEnv)) {
    throw new Error(
      `[ENV] Invalid NODE_ENV value: "${value}"\n` +
        `Valid values are: ${VALID_NODE_ENVS.join(', ')}`,
    );
  }
  return value as NodeEnv;
}

/**
 * Validates and retrieves LOG_LEVEL environment variable.
 * @returns Validated log level
 */
function getLogLevel(): string {
  const value = process.env.LOG_LEVEL ?? 'info';
  if (!VALID_LOG_LEVELS.includes(value as (typeof VALID_LOG_LEVELS)[number])) {
    console.warn(
      `[ENV] Invalid LOG_LEVEL value: "${value}". Using default: "info".\n` +
        `Valid values are: ${VALID_LOG_LEVELS.join(', ')}`,
    );
    return 'info';
  }
  return value;
}

// ============================================================================
// CONFIGURATION OBJECT
// ============================================================================

// Cache NODE_ENV to avoid multiple validations
const nodeEnv = getNodeEnv();

/**
 * Validated environment configuration.
 * Access environment variables through this object for type safety.
 *
 * @example
 * ```typescript
 * import { env } from '@/config/env.config.js';
 *
 * console.log(env.NODE_ENV);       // 'development' | 'production' | 'test'
 * console.log(env.PORT);           // '3000'
 *
 * if (env.isDevelopment) {
 *   // Development-only code
 * }
 * ```
 */
export const env: EnvConfig = {
  // Core environment
  NODE_ENV: nodeEnv,
  PORT: getRequiredEnv('PORT'),

  // Logging configuration
  LOG_LEVEL: getLogLevel(),
  LOG_FILE_PATH: getOptionalEnv('LOG_FILE_PATH'),
  ERROR_LOG_FILE_PATH: getOptionalEnv('ERROR_LOG_FILE_PATH'),
  // Consumed by telegram/listener.ts — centralised here so dotenv is guaranteed to have run first
  TELEGRAM_WEBHOOK_DOMAIN: getOptionalEnv('TELEGRAM_WEBHOOK_DOMAIN'),
  // Paired with TELEGRAM_WEBHOOK_DOMAIN — both consumed by telegram/listener.ts in the same webhook block
  TELEGRAM_WEBHOOK_SECRET_TOKEN: getOptionalEnv('TELEGRAM_WEBHOOK_SECRET_TOKEN'),

  // Database
  DATABASE_TYPE: getOptionalEnv('DATABASE_TYPE'),

  // Bot Management API / Web
  BETTER_AUTH_SECRET: getRequiredEnv('BETTER_AUTH_SECRET'),
  BETTER_AUTH_URL: getRequiredEnv('BETTER_AUTH_URL'),
  VITE_URL: getOptionalEnv('VITE_URL'),
  VITE_EMAIL_SERVICES_ENABLE: getOptionalEnv('VITE_EMAIL_SERVICES_ENABLE'),

  // Gmail SMTP — read at startup; absent vars produce undefined without throwing
  GMAIL_USER: getOptionalEnv('GMAIL_USER'),
  GOOGLE_APP_PASSWORD: getOptionalEnv('GOOGLE_APP_PASSWORD'),

  // Security
  ENCRYPTION_KEY: getRequiredEnv('ENCRYPTION_KEY'),
  // Groq API — optional; only needed for AI-powered commands/agent
  GROQ_API_KEY: getOptionalEnv('GROQ_API_KEY'),

  // Derived boolean helpers for convenience
  isDevelopment: nodeEnv === 'development',
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
} as const;
