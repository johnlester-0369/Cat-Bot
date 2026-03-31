/**
 * Command Parser — prefix stripping and token extraction.
 *
 * Pure function with no side effects — independently testable and reusable
 * across any platform that needs prefix-based command routing.
 */

import type { ParsedCommand } from '../types/controller.types.js';

/**
 * Strips the prefix from the first token and returns the command name + remaining args.
 * Returns null when the body does not start with the prefix.
 */
export function parseCommand(
  args: string[],
  prefix: string,
): ParsedCommand | null {
  if (!args.length) return null;

  const tokens = [...args];
  let commandName: string;

  if (tokens[0] === prefix) {
    // Edge case: prefix sent as a standalone token (some platforms split differently)
    if (tokens.length === 1) return null;
    tokens.shift();
    commandName = (tokens.shift() ?? '').toLowerCase();
  } else if (tokens[0]!.startsWith(prefix)) {
    const head = tokens.shift()!;
    commandName = head.slice(prefix.length).toLowerCase();
    if (!commandName) return null;
  } else {
    return null;
  }

  return { name: commandName, args: tokens };
}
