import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Textarea from '@/components/ui/forms/Textarea'
import type { Platform } from '@/features/users/dtos/bot.dto'
import { Platforms } from '@/constants/platform.constants'

// Unified schema covering all platform credentials required during both creation and edits
export interface PlatformFields {
  discordToken: string
  discordClientId: string
  telegramToken: string
  fbPageAccessToken: string
  fbPageId: string
  appstate: string
}

export interface PlatformFieldInputsProps {
  platform: Platform | string
  fields: PlatformFields
  onChange: (key: keyof PlatformFields, value: string) => void
}

/**
 * Shared component rendering the correct credential inputs based on the selected platform.
 * Prevents UI divergence between the 'Create New Bot' wizard and the 'Bot Settings' tab.
 */
export function PlatformFieldInputs({
  platform,
  fields,
  onChange,
}: PlatformFieldInputsProps) {
  switch (platform) {
    case Platforms.Discord:
      return (
        <>
          <Field.Root>
            <Field.Label>Discord Token</Field.Label>
            <Input
              placeholder="Bot token from Discord Developer Portal"
              value={fields.discordToken}
              onChange={(e) => onChange('discordToken', e.target.value)}
            />
          </Field.Root>
        </>
      )

    case Platforms.Telegram:
      return (
        <Field.Root>
          <Field.Label>Telegram Token</Field.Label>
          <Input
            placeholder="Token from @BotFather"
            value={fields.telegramToken}
            onChange={(e) => onChange('telegramToken', e.target.value)}
          />
        </Field.Root>
      )

    case Platforms.FacebookPage:
      return (
        <>
          <Field.Root>
            <Field.Label>FB Page Access Token</Field.Label>
            <Input
              placeholder="Page access token from Meta for Developers"
              value={fields.fbPageAccessToken}
              onChange={(e) => onChange('fbPageAccessToken', e.target.value)}
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>FB Page ID</Field.Label>
            <Input
              placeholder="Your Facebook Page numeric ID"
              value={fields.fbPageId}
              onChange={(e) => onChange('fbPageId', e.target.value)}
            />
          </Field.Root>
        </>
      )

    case Platforms.FacebookMessenger:
      return (
        <Field.Root>
          <Field.Label>Appstate</Field.Label>
          <Textarea
            placeholder="Paste your Facebook appstate JSON here"
            rows={6}
            value={fields.appstate}
            onChange={(e) => onChange('appstate', e.target.value)}
          />
        </Field.Root>
      )

    default:
      return null
  }
}
