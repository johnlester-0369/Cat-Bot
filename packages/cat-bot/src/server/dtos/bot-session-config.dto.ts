/**
 * Bot Session Config DTOs — Commands & Events Toggle API
 *
 * Shared type contracts between the server controller and client.
 * Kept separate from bot.dto.ts because these types model operational
 * runtime toggles rather than identity/credential configuration.
 */

export interface BotCommandItemDto {
  commandName: string;
  isEnable: boolean;
  version?: string;
  description?: string;
  usage?: string;
  role?: number;
  aliases?: string[];
  cooldown?: number;
  author?: string;
}

export interface GetBotCommandsResponseDto {
  commands: BotCommandItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BotEventItemDto {
  eventName: string;
  isEnable: boolean;
  version?: string;
  description?: string;
  author?: string;
}

export interface GetBotEventsResponseDto {
  events: BotEventItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** PUT body for both command and event toggles */
export interface ToggleEnabledRequestDto {
  isEnable: boolean;
}
