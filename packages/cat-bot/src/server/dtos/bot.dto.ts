// Discriminated union on `platform` — TypeScript exhaustiveness forces every consumer
// (repo, controller) to handle all four platforms at compile time rather than runtime.
export type PlatformCredentials =
  | { platform: 'discord'; discordToken: string; discordClientId: string }
  | { platform: 'telegram'; telegramToken: string }
  | { platform: 'facebook_page'; fbAccessToken: string; fbPageId: string }
  | { platform: 'facebook_messenger'; appstate: string };

export interface CreateBotRequestDto {
  botNickname: string;
  botPrefix: string;
  // Array of platform-native user IDs — each maps to a separate bot_admin row so
  // multiple admins are granted without comma-delimited strings that are hard to parse.
  botAdmins: string[];
  credentials: PlatformCredentials;
}

export interface CreateBotResponseDto {
  sessionId: string;
  userId: string;
  platformId: number;
  nickname: string;
  prefix: string;
}

export interface GetBotListItemDto {
  sessionId: string;
  platformId: number;
  // Human-readable platform string derived from ID_TO_PLATFORM in the repo layer
  platform: string;
  nickname: string;
  prefix: string;
}

export interface GetBotListResponseDto {
  bots: GetBotListItemDto[];
}

export interface GetBotDetailResponseDto {
  sessionId: string;
  userId: string;
  platformId: number;
  platform: string;
  nickname: string;
  prefix: string;
  admins: string[];
  credentials: PlatformCredentials;
}

// Omits the platform field inside the update itself to ensure PK immutability
export type UpdateBotRequestDto = CreateBotRequestDto;
