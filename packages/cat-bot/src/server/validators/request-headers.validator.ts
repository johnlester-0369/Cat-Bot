import type { Request } from 'express';

/**
 * Converts Node.js IncomingHttpHeaders to the Web API Headers object.
 *
 * Better-auth's getSession() expects the browser Headers API, not Node's
 * IncomingHttpHeaders. This conversion was previously duplicated verbatim inside
 * every controller method (8 copies in BotController alone). Centralising here
 * means a single place to update if the header-joining logic ever needs to change
 * (e.g. handling Set-Cookie arrays differently).
 */
export function toHeaders(req: Request): Headers {
  const h = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val === undefined) continue;
    h.set(key, Array.isArray(val) ? val.join(', ') : val);
  }
  return h;
}