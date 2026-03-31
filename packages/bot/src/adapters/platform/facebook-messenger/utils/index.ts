/**
 * Barrel export for all facebook-messenger utility functions.
 *
 * Consumers can import from a single path:
 *   import { normalizeMessageEvent, bufferToStream } from './utils/index.js';
 */

export { normalizeMessageEvent } from './normalize-event.js';
export { bufferToStream, urlToStream } from './streams.js';
