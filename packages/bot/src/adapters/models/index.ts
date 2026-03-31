/**
 * Single import point for all model types.
 * Platform wrappers and command modules can import from here
 * rather than reaching into individual model files.
 *
 * ARCHITECTURE (Modular):
 *   - enums/        → EventType, AttachmentType, LogMessageType
 *   - prototypes/   → PROTO_ATTACHMENT_*, PROTO_EVENT_*
 *   - interfaces/   → SendPayload, ThreadContext, ChatContext, etc.
 *   - *.model.ts    → UnifiedApi class, formatEvent factory, context factories
 *
 * nodenext module resolution requires the .js extension on all relative
 * specifiers — even when the source file is .ts. tsc-alias resolves these
 * to the compiled output paths at build time; tsx resolves them at dev time.
 */

// ── Core models (classes and factories) ────────────────────────────────────────
export * from './api.model.js';
export * from './event.model.js';
// command.js does not exist in the compiled output — removed to fix TS2307.
// If command functionality is needed, its module must be created before re-adding here.
export * from './context.model.js';

// PlatformId is exported from both api.model and user.model/thread.model (each defines it
// independently as `string` for leaf-node isolation). Wildcard re-export causes TS2308.
// Explicit named re-exports with PlatformId excluded from user/thread resolve the ambiguity.
export type {
  UnifiedUserInfo,
  PROTO_UNIFIED_USER_INFO,
  createUnifiedUserInfo,
} from './user.model.js';
export type {
  UnifiedThreadInfo,
  PROTO_UNIFIED_THREAD_INFO,
  createUnifiedThreadInfo,
} from './thread.model.js';

// ── Enumerations ───────────────────────────────────────────────────────────────
export * from './enums/index.js';

// ── Prototype objects ──────────────────────────────────────────────────────────
export * from './prototypes/index.js';

// ── Interface types ─────────────────────────────────────────────────────────────
export * from './interfaces/index.js';
