/**
 * Web Platform Constants — Single Source of Truth
 *
 * Mirrors cat-bot's platform.constants.ts so the web client and server runtime
 * use identical string identifiers. All platform strings use hyphen format
 * (e.g. 'facebook-page') for consistency with the cat-bot engine's Platforms enum.
 *
 * DO NOT use raw string literals like 'facebook_page' anywhere in the web package —
 * import Platforms.FacebookPage instead so renaming a platform only requires
 * changing this file.
 */

export const Platforms = {
  Discord: 'discord',
  Telegram: 'telegram',
  FacebookMessenger: 'facebook-messenger',
  FacebookPage: 'facebook-page',
} as const

/** Union of all recognised platform name strings (hyphen format). */
export type Platform = (typeof Platforms)[keyof typeof Platforms]

/**
 * Human-readable display labels for platform identifiers.
 * Typed as Record<string, string> so getPlatformLabel() can accept arbitrary
 * strings without a cast while still providing correct values for all known platforms.
 */
export const PLATFORM_LABELS: Record<string, string> = {
  [Platforms.Discord]: 'Discord',
  [Platforms.Telegram]: 'Telegram',
  [Platforms.FacebookPage]: 'Facebook Page',
  [Platforms.FacebookMessenger]: 'Facebook Messenger',
}
