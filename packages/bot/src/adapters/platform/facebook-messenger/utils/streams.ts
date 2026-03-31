/**
 * Facebook Messenger — Stream Utility Re-exports
 *
 * Single local import point for stream primitives so lib/ files
 * never need to reach two levels up for a buffer/stream helper.
 */

// Stream utilities delegated to the shared module — one source of truth for buffer/stream ops.
// @/ alias resolves to src/ per tsconfig paths; nodenext requires the .js extension.
export { bufferToStream, urlToStream } from '@/utils/streams.util.js';
