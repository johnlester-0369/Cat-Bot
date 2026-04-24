import apiClient from '@/lib/api-client.lib'
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
  GetBotCommandsResponseDto,
  GetBotEventsResponseDto,
} from '@/features/users/dtos/bot.dto'

export class BotService {
  async createBot(dto: CreateBotRequestDto): Promise<CreateBotResponseDto> {
    // Vite's dev proxy (vite.config.ts server.proxy) forwards /api/* to Express at
    // localhost:3000 — no explicit baseURL needed. Production deploys behind the same
    // origin reverse proxy so same-origin behaviour holds without extra config.
    const response = await apiClient.post<CreateBotResponseDto>(
      '/api/v1/bots',
      dto,
    )
    return response.data
  }

  async getBot(id: string): Promise<GetBotDetailResponseDto> {
    const response = await apiClient.get<GetBotDetailResponseDto>(
      `/api/v1/bots/${id}`,
    )
    return response.data
  }

  async updateBot(
    id: string,
    dto: UpdateBotRequestDto,
  ): Promise<GetBotDetailResponseDto> {
    const response = await apiClient.put<GetBotDetailResponseDto>(
      `/api/v1/bots/${id}`,
      dto,
    )
    return response.data
  }

  // Auth is cookie-based (credentials: 'include' set in ApiClient), so no
  // explicit token header is needed — the session cookie travels automatically.
  async listBots(): Promise<GetBotListResponseDto> {
    const response = await apiClient.get<GetBotListResponseDto>('/api/v1/bots')
    return response.data
  }

  // Commands toggle — reads and mutates bot_session_commands rows for this session
  async getCommands(sessionId: string, page = 1, limit = 12, search = ''): Promise<GetBotCommandsResponseDto> {
    const response = await apiClient.get<GetBotCommandsResponseDto>(
      `/api/v1/bots/${sessionId}/commands`,
      { params: { page, limit, search } }
    )
    return response.data
  }

  async toggleCommand(
    sessionId: string,
    commandName: string,
    isEnable: boolean,
  ): Promise<void> {
    await apiClient.put(`/api/v1/bots/${sessionId}/commands/${commandName}`, {
      isEnable,
    })
  }

  // Events toggle — reads and mutates bot_session_events rows for this session
  async getEvents(sessionId: string, page = 1, limit = 12, search = ''): Promise<GetBotEventsResponseDto> {
    const response = await apiClient.get<GetBotEventsResponseDto>(
      `/api/v1/bots/${sessionId}/events`,
      { params: { page, limit, search } }
    )
    return response.data
  }

  async toggleEvent(
    sessionId: string,
    eventName: string,
    isEnable: boolean,
  ): Promise<void> {
    await apiClient.put(`/api/v1/bots/${sessionId}/events/${eventName}`, {
      isEnable,
    })
  }

  async startBot(id: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${id}/start`)
  }

  async stopBot(id: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${id}/stop`)
  }

  async restartBot(id: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${id}/restart`)
  }

  // Permanently deletes the bot session and all its associated data server-side.
  async deleteBot(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/bots/${id}`)
  }
}

export const botService = new BotService()
export default botService
