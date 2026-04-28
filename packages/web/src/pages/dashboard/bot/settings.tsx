import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Lock } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Divider from '@/components/ui/layout/Divider'
import Dialog from '@/components/ui/overlay/Dialog'
import Alert from '@/components/ui/feedback/Alert'
import { useBotUpdate } from '@/features/users/hooks/useBotUpdate'
import { useBotValidation } from '@/features/users/hooks/useBotValidation'
import type { PlatformCredentials } from '@/features/users/dtos/bot.dto'
import {
  PlatformFieldInputs,
  type PlatformFields,
} from '@/features/users/components/PlatformFieldInputs'
import { VerificationStatusDisplay } from '@/features/users/components/VerificationStatusDisplay'
import { getPlatformLabel } from '@/utils/bot.util'
import { botService } from '@/features/users/services/bot.service'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { Platforms } from '@/constants/platform.constants'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'

interface FormState {
  botNickname: string
  botPrefix: string
  botAdmins: string[]
  botPremiums: string[]
  platform: string
  platformFields: PlatformFields
}

/**
 * Settings Page — /dashboard/bot/settings?id=xxx
 * Handles bot property updates and dangerous actions.
 */
export default function BotSettingsPage() {
  const { bot, setBot, isActive } = useBotContext()
  const { updateBot, isLoading, error } = useBotUpdate()
  const [savePhase, setSavePhase] = useState<'idle' | 'clearing' | 'saving'>(
    'idle',
  )
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const navigate = useNavigate()
  const {
    status: verificationStatus,
    validate,
    reset: resetVerification,
  } = useBotValidation()
  const { snackbar, setPosition } = useSnackbar()

  const [form, setForm] = useState<FormState>({
    botNickname: bot.nickname,
    botPrefix: bot.prefix,
    botAdmins: bot.admins?.length > 0 ? bot.admins : [''],
    botPremiums: bot.premiums?.length > 0 ? bot.premiums : [''],
    platform: bot.credentials.platform,
    platformFields: {
      discordToken:
        bot.credentials.platform === Platforms.Discord
          ? bot.credentials.discordToken
          : '',
      discordClientId:
        bot.credentials.platform === Platforms.Discord
          ? (bot.credentials.discordClientId ?? '')
          : '',
      telegramToken:
        bot.credentials.platform === Platforms.Telegram
          ? bot.credentials.telegramToken
          : '',
      fbPageAccessToken:
        bot.credentials.platform === Platforms.FacebookPage
          ? bot.credentials.fbAccessToken
          : '',
      fbPageId:
        bot.credentials.platform === Platforms.FacebookPage
          ? bot.credentials.fbPageId
          : '',
      appstate:
        bot.credentials.platform === Platforms.FacebookMessenger
          ? bot.credentials.appstate
          : '',
    },
  })

  // ── Field handlers ────────────────────────────────────────────────────────

  const handleTopField = (
    key: keyof Omit<
      FormState,
      'botAdmins' | 'botPremiums' | 'platform' | 'platformFields'
    >,
    value: string,
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleAdminChange = (index: number, value: string) => {
    setForm((prev) => {
      const admins = [...prev.botAdmins]
      admins[index] = value
      return { ...prev, botAdmins: admins }
    })
  }

  const handleAddAdmin = () => {
    setForm((prev) => ({ ...prev, botAdmins: [...prev.botAdmins, ''] }))
  }

  const handleRemoveAdmin = (index: number) => {
    setForm((prev) => ({
      ...prev,
      botAdmins:
        prev.botAdmins.length > 1
          ? prev.botAdmins.filter((_, i) => i !== index)
          : prev.botAdmins,
    }))
  }

  const handlePremiumChange = (index: number, value: string) => {
    setForm((prev) => {
      const premiums = [...prev.botPremiums]
      premiums[index] = value
      return { ...prev, botPremiums: premiums }
    })
  }

  const handleAddPremium = () => {
    setForm((prev) => ({ ...prev, botPremiums: [...prev.botPremiums, ''] }))
  }

  const handleRemovePremium = (index: number) => {
    setForm((prev) => ({
      ...prev,
      botPremiums:
        prev.botPremiums.length > 1
          ? prev.botPremiums.filter((_, i) => i !== index)
          : prev.botPremiums,
    }))
  }

  const handlePlatformField = (key: keyof PlatformFields, value: string) => {
    resetVerification()
    setForm((prev) => ({
      ...prev,
      platformFields: { ...prev.platformFields, [key]: value },
    }))
  }

  // ── Verification ──────────────────────────────────────────────────────────

  const canVerify = (() => {
    switch (form.platform) {
      case Platforms.Discord:
        return !!form.platformFields.discordToken
      case Platforms.Telegram:
        return !!form.platformFields.telegramToken
      case Platforms.FacebookPage:
        return (
          !!form.platformFields.fbPageAccessToken &&
          !!form.platformFields.fbPageId
        )
      case Platforms.FacebookMessenger:
        return !!form.platformFields.appstate.trim()
      default:
        return false
    }
  })()

  const handleVerify = () => {
    if (!form.platform || !canVerify) return
    let credentials: PlatformCredentials
    switch (form.platform) {
      case Platforms.Discord:
        credentials = {
          platform: Platforms.Discord,
          discordToken: form.platformFields.discordToken,
        }
        break
      case Platforms.Telegram:
        credentials = {
          platform: Platforms.Telegram,
          telegramToken: form.platformFields.telegramToken,
        }
        break
      case Platforms.FacebookPage:
        credentials = {
          platform: Platforms.FacebookPage,
          fbAccessToken: form.platformFields.fbPageAccessToken,
          fbPageId: form.platformFields.fbPageId,
        }
        break
      case Platforms.FacebookMessenger:
        credentials = {
          platform: Platforms.FacebookMessenger,
          appstate: form.platformFields.appstate,
        }
        break
      default:
        return
    }
    validate(credentials)
  }

  const isFbPageWaiting =
    verificationStatus.phase === 'fbpage-webhook-pending' ||
    verificationStatus.phase === 'fbpage-otp-pending'

  // ── Save-guard ────────────────────────────────────────────────────────────

  const isCredentialsModified = (() => {
    if (form.platform === Platforms.Discord)
      return (
        form.platformFields.discordToken !==
        (bot.credentials.platform === Platforms.Discord
          ? bot.credentials.discordToken
          : '')
      )
    if (form.platform === Platforms.Telegram)
      return (
        form.platformFields.telegramToken !==
        (bot.credentials.platform === Platforms.Telegram
          ? bot.credentials.telegramToken
          : '')
      )
    if (form.platform === Platforms.FacebookPage)
      return (
        form.platformFields.fbPageAccessToken !==
          (bot.credentials.platform === Platforms.FacebookPage
            ? bot.credentials.fbAccessToken
            : '') ||
        form.platformFields.fbPageId !==
          (bot.credentials.platform === Platforms.FacebookPage
            ? bot.credentials.fbPageId
            : '')
      )
    if (form.platform === Platforms.FacebookMessenger)
      return (
        form.platformFields.appstate !==
        (bot.credentials.platform === Platforms.FacebookMessenger
          ? bot.credentials.appstate
          : '')
      )
    return false
  })()

  const isFbPage = form.platform === Platforms.FacebookPage

  // Block save if user clears all inputs for platforms that require an admin
  const hasValidAdmins = isFbPage || form.botAdmins.some((a) => a.trim() !== '')

  const disableSave =
    savePhase !== 'idle' ||
    isLoading ||
    (isCredentialsModified && verificationStatus.phase !== 'success') ||
    !hasValidAdmins

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    let credentials: PlatformCredentials
    switch (form.platform) {
      case Platforms.Discord:
        credentials = {
          platform: Platforms.Discord,
          discordToken: form.platformFields.discordToken,
          discordClientId: form.platformFields.discordClientId,
        }
        break
      case Platforms.Telegram:
        credentials = {
          platform: Platforms.Telegram,
          telegramToken: form.platformFields.telegramToken,
        }
        break
      case Platforms.FacebookPage:
        credentials = {
          platform: Platforms.FacebookPage,
          fbAccessToken: form.platformFields.fbPageAccessToken,
          fbPageId: form.platformFields.fbPageId,
        }
        break
      case Platforms.FacebookMessenger:
        credentials = {
          platform: Platforms.FacebookMessenger,
          appstate: form.platformFields.appstate,
        }
        break
      default:
        return
    }

    try {
      const isSlashPlatform =
        bot.credentials.platform === Platforms.Discord ||
        bot.credentials.platform === Platforms.Telegram

      if (
        isCredentialsModified &&
        bot.prefix === '/' &&
        isActive &&
        isSlashPlatform
      ) {
        setSavePhase('clearing')
        await updateBot(bot.sessionId, {
          botNickname: bot.nickname,
          botPrefix: '-',
          botAdmins: bot.admins,
          botPremiums: bot.premiums,
          credentials: bot.credentials,
        })
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      setSavePhase('saving')
      const updated = await updateBot(bot.sessionId, {
        botNickname: form.botNickname,
        botPrefix: form.botPrefix,
        botAdmins: isFbPage ? [] : form.botAdmins.filter((a) => a.trim() !== ''),
        botPremiums: isFbPage ? [] : form.botPremiums.filter((p) => p.trim() !== ''),
        credentials,
      })

      setBot(updated)

      if (isCredentialsModified && isActive) {
        await botService.restartBot(bot.sessionId).catch(console.error)
        setPosition('bottom-right')
        snackbar({
          message: 'Bot settings saved and session reloaded successfully.',
          color: 'success',
          duration: 5000,
        })
      } else {
        setPosition('bottom-right')
        snackbar({
          message: 'Bot settings saved successfully.',
          color: 'success',
          duration: 4000,
        })
      }
    } catch {
      // Errors bubbled to UI via `error` state from useBotUpdate
    } finally {
      setSavePhase('idle')
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await botService.deleteBot(bot.sessionId)
      setPosition('bottom-right')
      snackbar({
        message: `"${bot.nickname}" has been permanently deleted.`,
        color: 'success',
        duration: 4000,
      })
      navigate('/dashboard')
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete bot',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div>
            <Card.Title as="h3">Bot Identity</Card.Title>
            <Card.Description>
              Display name, command prefix{isFbPage ? '' : ', and admin user IDs'}.
            </Card.Description>
          </div>
        </Card.Header>

        <div className="grid grid-cols-2 gap-4">
          <Field.Root required>
            <Field.Label>Nickname</Field.Label>
            <Input
              value={form.botNickname}
              onChange={(e) => handleTopField('botNickname', e.target.value)}
              placeholder="e.g. Cat Bot"
            />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Prefix</Field.Label>
            <Input
              value={form.botPrefix}
              onChange={(e) => handleTopField('botPrefix', e.target.value)}
              placeholder="e.g. /"
            />
          </Field.Root>
        </div>

        <Divider spacing="md" />

        {isFbPage && (
          <div className="mb-2 mt-[-8px]">
            <Alert
              variant="tonal"
              color="info"
              title="Role Management"
              message="Admin and Premium IDs are not needed for Facebook Pages. Access is automatically and securely managed through your Meta Page roles using PSIDs."
            />
          </div>
        )}

        <div className={`flex flex-col gap-3 ${isFbPage ? 'opacity-60' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-label-md font-medium text-on-surface">
                Bot Admins
              </p>
              <p className="text-label-sm text-on-surface-variant mt-0.5">
                User IDs that have admin privileges
              </p>
            </div>
            <Button
              variant="text"
              color="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={handleAddAdmin}
              disabled={isFbPage}
            >
              Add
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {form.botAdmins.map((adminId, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    placeholder={`Admin user ID ${index + 1}`}
                    value={adminId}
                    onChange={(e) => handleAdminChange(index, e.target.value)}
                    disabled={isFbPage}
                  />
                </div>
                {form.botAdmins.length > 1 && (
                  <Button
                    variant="text"
                    color="error"
                    iconOnly
                    onClick={() => handleRemoveAdmin(index)}
                    leftIcon={<Trash2 className="h-4 w-4" />}
                    disabled={isFbPage}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <Divider spacing="md" />

        <div className={`flex flex-col gap-3 ${isFbPage ? 'opacity-60' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-label-md font-medium text-on-surface">
                Bot Premiums
              </p>
              <p className="text-label-sm text-on-surface-variant mt-0.5">
                User IDs with premium command privileges
              </p>
            </div>
            <Button
              variant="text"
              color="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={handleAddPremium}
              disabled={isFbPage}
            >
              Add
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {form.botPremiums.map((premiumId, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    placeholder={`Premium user ID ${index + 1}`}
                    value={premiumId}
                    onChange={(e) => handlePremiumChange(index, e.target.value)}
                    disabled={isFbPage}
                  />
                </div>
                {form.botPremiums.length > 1 && (
                  <Button
                    variant="text"
                    color="error"
                    iconOnly
                    onClick={() => handleRemovePremium(index)}
                    leftIcon={<Trash2 className="h-4 w-4" />}
                    disabled={isFbPage}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </Card.Root>

      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div>
            <Card.Title as="h3">Platform Credentials</Card.Title>
            <Card.Description>
              Tokens used to connect this bot to its messaging platform.
            </Card.Description>
          </div>
        </Card.Header>

        <Field.Root>
          <Field.Label>Platform</Field.Label>
          <Input
            value={getPlatformLabel(form.platform)}
            readOnly
            disabled
            leftIcon={<Lock className="h-4 w-4" />}
          />
          <p className="mt-1.5 text-body-sm text-on-surface-variant">
            Platform cannot be changed after creation.
          </p>
        </Field.Root>

        <Divider spacing="md" />

        <div className="flex flex-col gap-4">
          <PlatformFieldInputs
            platform={form.platform}
            fields={form.platformFields}
            onChange={handlePlatformField}
          />
        </div>

        {verificationStatus.phase !== 'idle' && (
          <>
            <Divider spacing="md" />
            <VerificationStatusDisplay status={verificationStatus} />
          </>
        )}

        <div className="flex items-center justify-end mt-4">
          {verificationStatus.phase === 'success' ? (
            <Button variant="tonal" color="success" size="sm" disabled>
              Verified
            </Button>
          ) : isFbPageWaiting ? null : (
            <Button
              variant="tonal"
              color="primary"
              size="sm"
              onClick={handleVerify}
              disabled={!canVerify || verificationStatus.phase === 'validating'}
            >
              {verificationStatus.phase === 'validating'
                ? 'Verifying…'
                : 'Verify Credentials'}
            </Button>
          )}
        </div>
      </Card.Root>

      <div className="flex items-start gap-3">
        <div className="flex-1">
          {error && <p className="text-body-sm text-error">{error}</p>}
        </div>
        <Button
          variant="filled"
          color="primary"
          disabled={disableSave}
          isLoading={savePhase !== 'idle' || isLoading}
          onClick={() => void handleSubmit()}
        >
          {savePhase === 'clearing'
            ? 'Clearing old commands...'
            : 'Save Changes'}
        </Button>
      </div>

      <Divider spacing="lg" />

      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border-error/30 bg-error/5"
      >
        <Card.Header>
          <div>
            <Card.Title as="h3" className="text-error">
              Danger Zone
            </Card.Title>
            <Card.Description>
              Permanently delete this bot and all its associated data.
            </Card.Description>
          </div>
        </Card.Header>
        <div className="flex flex-col gap-4 mt-2">
          <Alert
            variant="tonal"
            color="error"
            title="Proceed with caution"
            message="Once you delete a bot, there is no going back. Please be certain."
          />
          <div className="flex justify-end">
            <Dialog.Root>
              <Dialog.Trigger asChild>
                <Button
                  size="sm"
                  className="!bg-[rgb(var(--light-color-error))] !text-[rgb(var(--light-color-surface))] w-full sm:w-auto"
                >
                  Delete Bot
                </Button>
              </Dialog.Trigger>
              <Dialog.Positioner position="center">
                <Dialog.Backdrop />
                <Dialog.Content size="sm">
                  <Dialog.Header>
                    <Dialog.Title>Delete Bot</Dialog.Title>
                    <Dialog.CloseTrigger />
                  </Dialog.Header>
                  <Dialog.Body>
                    <p>
                      Are you sure you want to permanently delete{' '}
                      <strong>{bot.nickname}</strong>? This action cannot be
                      undone.
                    </p>
                    {deleteError && (
                      <p className="mt-2 text-body-sm text-error">
                        {deleteError}
                      </p>
                    )}
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Dialog.CloseTrigger asChild>
                      <Button variant="text" color="neutral">
                        Cancel
                      </Button>
                    </Dialog.CloseTrigger>
                    <Button
                      className="!bg-[rgb(var(--light-color-error))] !text-[rgb(var(--light-color-surface))]"
                      isLoading={isDeleting}
                      disabled={isDeleting}
                      onClick={() => void handleDelete()}
                    >
                      Yes, Delete Bot
                    </Button>
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog.Positioner>
            </Dialog.Root>
          </div>
        </div>
      </Card.Root>
    </div>
  )
}
