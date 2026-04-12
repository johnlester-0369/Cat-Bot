/**
 * /system — Host Hardware & OS Information Card
 *
 * Displays a full snapshot of the host machine's hardware configuration and
 * current resource utilisation using only Node.js built-in APIs:
 *
 *   os.cpus()     — CPU model, physical core count, clock speed
 *   os.totalmem() — total installed RAM
 *   os.freemem()  — available RAM (not reserved by OS page cache)
 *   os.loadavg()  — 1/5/15-minute POSIX load averages (zero on Windows)
 *   os.platform() — 'linux' | 'darwin' | 'win32' | …
 *   os.type()     — 'Linux' | 'Darwin' | 'Windows_NT'
 *   os.release()  — kernel / OS version string
 *   os.arch()     — CPU instruction set ('x64', 'arm64', …)
 *   os.uptime()   — host (not process) uptime in seconds
 *
 * No external packages (systeminformation, pidusage) are needed — native APIs
 * provide sufficient depth for typical bot system-monitoring use.
 */

import os from 'node:os';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

export const config = {
  name: 'system',
  aliases: ['sysinfo'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Displays host hardware and OS information using built-in Node.js APIs',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

/**
 * Converts raw bytes to a human-readable string with 1024-based units.
 * Mirrors the helper in uptime.ts — kept local to avoid a shared-utility
 * dependency on a file that doesn't exist yet.
 */
function formatBytes(bytes: number): string {
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const formatted =
    value < 10 && unitIndex > 0
      ? value.toFixed(1)
      : Math.round(value).toString();
  return `${formatted} ${units[unitIndex] ?? 'Bytes'}`;
}

/**
 * Converts a total-seconds value into a "Xd Xh Xm Xs" uptime string.
 * Used for host OS uptime (os.uptime()), which can be days-long on servers.
 */
function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

const ACTION_ID = { refresh: 'refresh' } as const;

// onCommand defined before menu so the refresh handler can reference it directly.
export const onCommand = async ({ chat, startTime, native, event }: AppCtx): Promise<void> => {
  const cpus = os.cpus();

  // os.cpus() returns one entry per logical core — deduplicate model name and derive
  // physical + logical counts for a display that matches what system monitors show.
  const cpuModel = cpus[0]?.model.trim() ?? 'Unknown';
  const logicalCores = cpus.length;
  // Clock speed is reported in MHz per logical core — convert to GHz for readability
  const speedGHz = ((cpus[0]?.speed ?? 0) / 1000).toFixed(2);

  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const usedRam = totalRam - freeRam;
  const usedPct = ((usedRam / totalRam) * 100).toFixed(1);

  // Node process memory — rss is the best single metric for "how much RAM is this process using"
  const nodeMem = process.memoryUsage();

  // os.loadavg() is [1min, 5min, 15min] on POSIX; [0, 0, 0] on Windows
  const [load1, load5, load15] = os.loadavg() as [number, number, number];
  const loadLine =
    load1 > 0
      ? `**Load avg (1/5/15 min):** ${load1.toFixed(2)} / ${load5.toFixed(2)} / ${load15.toFixed(2)}`
      : `**Load avg:** N/A (Windows)`;

  const platform = os.platform(); // 'linux', 'darwin', 'win32', ...
  const osType = os.type(); // 'Linux', 'Darwin', 'Windows_NT'
  const osRelease = os.release(); // kernel version / OS build string
  const arch = os.arch(); // 'x64', 'arm64', ...
  const hostUptime = os.uptime(); // host OS uptime in seconds (NOT process uptime)

  // Skip buttons on FB Messenger — text-menu fallback adds noise to a multi-line info card.
  const hasNativeButtons =
    native.platform === Platforms.Discord ||
    native.platform === Platforms.Telegram ||
    native.platform === Platforms.FacebookPage;

  const ping = Date.now() - startTime;

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: [
      '**System Info**',
      '',
      '**— CPU —**',
      `**Model:** ${cpuModel}`,
      `**Logical Cores:** ${logicalCores}`,
      `**Speed:** ${speedGHz} GHz`,
      loadLine,
      '',
      '**— Memory —**',
      `**Total:** ${formatBytes(totalRam)}`,
      `**Used:** ${formatBytes(usedRam)} (${usedPct}%)`,
      `**Free:** ${formatBytes(freeRam)}`,
      `**Node RSS:** ${formatBytes(nodeMem.rss)}`,
      `**Node Heap:** ${formatBytes(nodeMem.heapUsed)} / ${formatBytes(nodeMem.heapTotal)}`,
      '',
      '**— OS —**',
      `**Type:** ${osType}`,
      `**Platform:** ${platform}`,
      `**Release:** ${osRelease}`,
      `**Arch:** ${arch}`,
      `**Host Uptime:** ${formatUptime(hostUptime)}`,
      `**Process Uptime:** ${formatUptime(Math.floor(process.uptime()))}`,
      `**Ping:** ${ping}ms`,
    ].join('\n'),
    ...(hasNativeButtons ? { button: [ACTION_ID.refresh] } : {}),
  };

  // Update the existing message if triggered via button; otherwise send a new message
  if (event['type'] === 'button_action') {
    await chat.editMessage({ ...payload, message_id_to_edit: event['messageID'] as string });
  } else {
    await chat.replyMessage(payload);
  }
};

// Placed after onCommand — const is fully initialized when this object literal evaluates.
export const menu = {
  [ACTION_ID.refresh]: {
    label: '🔄 Refresh',
    button_style: ButtonStyle.SECONDARY,
    // Re-fetches all hardware metrics identically to re-issuing /system.
    run: (ctx: AppCtx) => onCommand(ctx),
  },
};
