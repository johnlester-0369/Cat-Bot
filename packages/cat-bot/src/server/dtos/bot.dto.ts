// Discriminated union on `platform` — TypeScript exhaustiveness forces every consumer
// (repo, controller) to handle all four platforms at compile time rather than runtime.
export type PlatformCredentials =
  | { platform: 'discord'; discordToken: string; discordClientId: string }
  | { platform: 'telegram'; telegramToken: string }
  | { platform: 'facebook-page'; fbAccessToken: string; fbPageId: string }
  | { platform: 'facebook-messenger'; appstate: string };

export interface CreateBotRequestDto {
  botNickname: string;
  botPrefix: string;
  // Platform-native user IDs granted admin privileges — one row per ID in bot_admin.
  botAdmins: string[];
  // Optional so existing callers (e.g. create-new-bot wizard) are unaffected; defaults to [] in adapters.
  botPremiums?: string[];
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
  premiums: string[];
  credentials: PlatformCredentials;
}

// Omits the platform field inside the update itself to ensure PK immutability
export type UpdateBotRequestDto = CreateBotRequestDto;
