import apiClient from '@/lib/api-client.lib'

export interface FbWebhookInfoDto {
  webhookUrl: string
  verifyToken: string
  isVerified: boolean
}

export class WebhookService {
  async getFacebookWebhookInfo(): Promise<FbWebhookInfoDto> {
    const response = await apiClient.get<FbWebhookInfoDto>(
      '/api/v1/webhooks/facebook',
    )
    return response.data
  }
}

export const webhookService = new WebhookService()
export default webhookService
