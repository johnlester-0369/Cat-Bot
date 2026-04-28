/**
 * /checkapis — API Registry Health Check (Bot Admin Only)
 *
 * Pings the base URL of every registered API provider and reports its HTTP
 * status. Results use >ᴗ< for reachable (2xx–4xx) and •︵• for unreachable
 * or errored responses, matching the original command's output format.
 *
 * Uses the documented `listApis()` export from api.util to enumerate all
 * providers at runtime — no URLs or registry names are hardcoded here.
 * Uses `createUrl(name, '/')` to resolve each provider's base URL through
 * the same engine registry used by all other commands.
 *
 * ⚠️  `Role.OWNER` does not exist in Cat Bot's documented role constants.
 *     The original `permissions: { owner: true }` is mapped to `Role.BOT_ADMIN`
 *     (value 2 — bot admins added via /admin add). If you need true owner-only
 *     access, use `Role.SYSTEM_ADMIN` (value 4) instead.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl, listApis } from '@/engine/utils/api.util.js';
import type { CommandConfig } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 5000;

// ── Command Config ────────────────────────────────────────────────────────────

export const config: CommandConfig = {
  name: 'checkapis',
  aliases: ['cekapi', 'checkapi'] as string[],
  version: '1.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description: 'Check the status of all registered API base URLs.',
  category: 'system',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat }: AppCtx): Promise<void> => {
  const apis = listApis();
  const lines: string[] = [];

  for (const name of Object.keys(apis)) {
    // createUrl resolves the registry entry's baseURL at runtime —
    // '/' is used as the endpoint so we ping the root of the base URL.
    const baseURL = createUrl(name, '/');

    if (!baseURL) {
      lines.push(`➛ ${name} •︵• (Registry not found)`);
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let status: number | null = null;

      try {
        const res = await fetch(baseURL, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
          },
        });
        status = res.status;
      } finally {
        clearTimeout(timeout);
      }

      // 2xx–4xx: server is reachable and responding
      if (status !== null && status >= 200 && status < 500) {
        lines.push(`➛ ${baseURL} >ᴗ< (${status})`);
      } else {
        lines.push(`➛ ${baseURL} •︵• (${status ?? 'No response'})`);
      }
    } catch (err) {
      const error = err as { name?: string; message?: string };

      if (error.name === 'AbortError') {
        lines.push(`➛ ${baseURL} •︵• (Timeout)`);
      } else {
        lines.push(`➛ ${baseURL} •︵• (Error: ${error.message ?? 'Unknown'})`);
      }
    }
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: lines.join('\n'),
  });
};