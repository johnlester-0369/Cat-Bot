/**
 * Platform Filter — Module Platform Guard
 *
 * Centralised helper that enforces config.platform[] declared by command and event modules.
 * Keeping the guard in one function means adding a new dispatch site (onCommand, onChat,
 * onEvent, onReply, onReact, button menu) never requires re-implementing the same
 * null/Array.isArray check logic.
 *
 * Module usage example:
 *
 *   export const config = {
 *     name: 'setgroupname',
 *     platform: ['discord', 'telegram'],  // ← only run on these two platforms
 *   };
 *
 * Default behaviour: if config.platform is absent or an empty array, the module runs
 * on ALL platforms — identical to the pre-filter behaviour.
 */

/**
 * Returns true when the module is allowed to run on the given platform.
 *
 * - No config.platform declared  → allow all platforms (backward-compatible default)
 * - Empty config.platform array  → allow all platforms (explicit "no filter" intent)
 * - Non-empty config.platform    → allow only the listed platform IDs; silently skip the rest
 *
 * @param mod      - The command or event module object (Record<string, unknown>)
 * @param platform - The current platform identifier sourced from native.platform or
 *                   ctx.native.platform (e.g. 'discord', 'telegram', 'facebook-messenger',
 *                   'facebook-page', 'unknown')
 */
export function isPlatformAllowed(
  mod: Record<string, unknown>,
  platform: string,
): boolean {
  const cfg = mod['config'] as Record<string, unknown> | undefined;
  const platforms = cfg?.['platform'];
  // No filter declared or empty array → allow all platforms (default behaviour)
  if (!Array.isArray(platforms) || platforms.length === 0) return true;
  return (platforms as unknown[]).includes(platform);
}
