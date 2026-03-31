/**
 * Cat-Bot — Send Payload Interface
 *
 * Type definitions for message sending payloads.
 * Extracted from api.model.ts for single-responsibility.
 *
 * NOTE: These interfaces are now defined in api.interfaces.ts for cohesion.
 * This file re-exports them for backward compatibility and to allow
 * future extension without modifying the core api.interfaces.ts file.
 */

// Re-export from api.interfaces.ts to maintain a single source of truth
export type { SendPayload, ReplyMessageOptions } from './api.interfaces.js';
