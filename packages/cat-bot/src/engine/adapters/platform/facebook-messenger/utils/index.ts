/**
 * Barrel export for all facebook-messenger utility functions.
 *
 * Consumers can import from a single path:
 *   import { normalizeMessageEvent, normalizeE2eeMessageEvent, bufferToStream } from './utils/index.js';
 */

export { normalizeMessageEvent, normalizeE2eeMessageEvent } from './normalize-event.js';
export { bufferToStream, urlToStream } from './streams.js';
