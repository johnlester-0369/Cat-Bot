/**
 * Button Style Registry
 *
 * Centralizes visual style hints for interactive buttons.
 * Only meaningful on platforms with visual component systems (Discord).
 * Other platforms (Telegram, Facebook Page) ignore the style constraint
 * and use labels exclusively.
 *
 * Defaults to SECONDARY for neutrality.
 */

export const ButtonStyle = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  SUCCESS: 'success',
  DANGER: 'danger',
} as const;

export type ButtonStyleValue = (typeof ButtonStyle)[keyof typeof ButtonStyle];
