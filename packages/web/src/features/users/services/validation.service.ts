/**
 * Validation Service — REST credential checks for Discord, Telegram, Facebook Messenger.
 *
 * Facebook Page validation is Socket.IO-based (useBotValidation hook) and not here.
 * Responses follow { valid: boolean, error?: string, botName?: string } contract.
 */

import apiClient from '@/lib/api-client.lib'

export interface ValidateResult {
  valid: boolean
  error?: string
  botName?: string
  botId?: string
}

export const validationService = {
  async validateDiscord(discordToken: string): Promise<ValidateResult> {
    const response = await apiClient.post<ValidateResult>(
      '/api/v1/validate/discord',
      { discordToken },
    )
    return response.data
  },

  async validateTelegram(telegramToken: string): Promise<ValidateResult> {
    const response = await apiClient.post<ValidateResult>(
      '/api/v1/validate/telegram',
      { telegramToken },
    )
    return response.data
  },

  async validateFacebookMessenger(appstate: string): Promise<ValidateResult> {
    const response = await apiClient.post<ValidateResult>(
      '/api/v1/validate/facebook-messenger',
      { appstate },
    )
    return response.data
  },
}
