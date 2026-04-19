/**
 * API URL Builder Utility
 *
 * A catalogue of free third-party API base URLs and a factory for building
 * fully-resolved, query-string-encoded endpoint URLs from them.
 *
 * Converted from the original CommonJS api.js to native ESM TypeScript so it
 * integrates cleanly with the Cat-Bot module system.
 *
 * Usage:
 *   import { createUrl, listApis } from '@/engine/utils/api.util.js';
 *
 *   // Named provider
 *   const url = createUrl('betadash', '/shazam', { title: 'Blinding Lights', limit: '1' });
 *
 *   // Arbitrary base URL
 *   const url = createUrl('https://my-api.example.com', '/v1/search', { q: 'hello' });
 */

// ── API registry ──────────────────────────────────────────────────────────────

interface ApiEntry {
  baseURL: string;
  /** Optional API key value stored alongside the provider record. */
  APIKey?: string;
}

/**
 * Registry of free third-party API providers.
 * Add or remove entries here — `createUrl` resolves them by name automatically.
 */
const APIs: Record<string, ApiEntry> = {
  betadash: {
    baseURL: 'https://betadash-api-swordslush-production.up.railway.app',
  },
  deline: {
    baseURL: 'https://api.deline.web.id',
  },
  kuroneko: {
    baseURL: 'https://api.danzy.web.id',
  },
  nekolabs: {
    baseURL: 'https://rynekoo-api.hf.space',
  },
  neo: {
    baseURL: 'https://www.neoapis.xyz',
  },
  nexray: {
    baseURL: 'https://api.nexray.web.id',
  },
  zenzxz: {
    baseURL: 'https://api.zenzxz.my.id',
  },
};

// ── URL factory ───────────────────────────────────────────────────────────────

/**
 * Builds a fully-resolved URL for a named API provider or an arbitrary base URL.
 *
 * @param apiNameOrURL   - A key from the APIs registry (e.g. `'betadash'`) OR a
 *                         full base URL string (e.g. `'https://my-api.example.com'`).
 * @param endpoint       - The API path to append (e.g. `'/shazam'`).
 * @param params         - Optional query-string key/value pairs. Values are
 *                         automatically URL-encoded by URLSearchParams.
 * @param apiKeyParamName - If provided AND the named provider has an `APIKey`,
 *                         the key is injected as this query-param name.
 * @returns The fully-resolved URL string, or `null` on error.
 *
 * @example
 * // Named provider — resolves to betadash baseURL + /shazam?title=...&limit=1
 * createUrl('betadash', '/shazam', { title: 'Blinding Lights', limit: '1' });
 *
 * // Provider with API key injection
 * createUrl('sanka', '/ai', { q: 'hello' }, 'apikey');
 * // → https://www.sankavolereii.my.id/ai?q=hello&apikey=planaai
 *
 * // Arbitrary base URL (not in registry)
 * createUrl('https://my-api.example.com', '/v1/data', { page: '2' });
 */
export function createUrl(
  apiNameOrURL: string,
  endpoint: string,
  params: Record<string, string> = {},
  apiKeyParamName?: string,
): string | null {
  try {
    const api = APIs[apiNameOrURL];

    // Resolve base: named provider → registry entry; otherwise treat as a raw URL
    let baseURL: string;
    if (api) {
      baseURL = api.baseURL;
    } else {
      // Validate the string is a proper URL — throws if malformed
      baseURL = new URL(apiNameOrURL).origin;
    }

    const queryParams = new URLSearchParams(params);

    // Inject the provider API key as a query param when requested
    if (apiKeyParamName && api?.APIKey) {
      queryParams.set(apiKeyParamName, api.APIKey);
    }

    const apiUrl = new URL(endpoint, baseURL);
    apiUrl.search = queryParams.toString();
    return apiUrl.toString();
  } catch (error) {
    console.error('[api.util] createUrl error:', error);
    return null;
  }
}

/**
 * Returns the full API registry — useful for listing available providers
 * or debugging which base URLs are configured.
 */
export function listApis(): Record<string, ApiEntry> {
  return APIs;
}
