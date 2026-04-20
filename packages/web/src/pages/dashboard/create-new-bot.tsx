import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Select from '@/components/ui/forms/Select'
import type { SelectOption } from '@/components/ui/forms/Select'
import Alert from '@/components/ui/feedback/Alert'
import DataList from '@/components/ui/data-display/DataList'
import Steps from '@/components/ui/navigation/Steps'
import Divider from '@/components/ui/layout/Divider'
import { ROUTES } from '@/constants/routes.constants'
import { useBotCreate } from '@/features/users/hooks/useBotCreate'
import { useBotValidation } from '@/features/users/hooks/useBotValidation'
import type {
  Platform,
  PlatformCredentials,
} from '@/features/users/dtos/bot.dto'
import { Platforms } from '@/constants/platform.constants'
import { getPlatformLabel, maskCredential } from '@/utils/bot.util'
import {
  PlatformFieldInputs,
  type PlatformFields,
} from '@/features/users/components/PlatformFieldInputs'
import { VerificationStatusDisplay } from '@/features/users/components/VerificationStatusDisplay'

const INITIAL_PLATFORM_FIELDS: PlatformFields = {
  discordToken: '',
  discordClientId: '',
  telegramToken: '',
  fbPageAccessToken: '',
  fbPageId: '',
  appstate: '',
}

interface FormState {
  botNickname: string
  botPrefix: string
  botAdmins: string[]
  platform: Platform | ''
  platformFields: PlatformFields
}

const PLATFORM_OPTIONS: SelectOption[] = [
  { value: Platforms.Discord, label: 'Discord' },
  { value: Platforms.Telegram, label: 'Telegram' },
  { value: Platforms.FacebookPage, label: 'Facebook Page' },
  { value: Platforms.FacebookMessenger, label: 'Facebook Messenger' },
]

const INITIAL_FORM: FormState = {
  botNickname: '',
  botPrefix: '',
  botAdmins: [''],
  platform: '',
  platformFields: INITIAL_PLATFORM_FIELDS,
}

/**
 * New Bot creation wizard — three-step flow.
 *
 * Step 1 collects bot identity (nickname, prefix, admins).
 * Step 2 collects + VALIDATES platform credentials via modular subcomponents.
 * Step 3 shows a read-only review summary before the final create action.
 *
 * Each step is fully self-contained inside a Card — header, content, and
 * action buttons all live inside the card using Card.Footer so there are no
 * floating button rows detached from their step context.
 */
export default function NewBotPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [currentStep, setCurrentStep] = useState(0)
  const { isLoading, error: botError, createBot } = useBotCreate()
  const {
    status: verificationStatus,
    validate,
    reset: resetVerification,
  } = useBotValidation()

  // ── Validation ──────────────────────────────────────────────────────────

  const isStep1Valid =
    form.botNickname.trim() !== '' &&
    form.botPrefix.trim() !== '' &&
    form.botAdmins.some((a) => a.trim() !== '')

  // Step 2 requires an explicit successful verification — the user cannot skip by
  // typing credentials and clicking Next; they must click Verify first.
  const isStep2Valid =
    form.platform !== '' && verificationStatus.phase === 'success'

  const handleStepChange = (step: number) => {
    if (step <= currentStep) {
      setCurrentStep(step)
      return
    }
    if (step !== currentStep + 1) return
    if (currentStep === 0 && !isStep1Valid) return
    if (currentStep === 1 && !isStep2Valid) return
    setCurrentStep(step)
  }

  // ── Field handlers ──────────────────────────────────────────────────────

  const handleTopField = (
    key: keyof Omit<FormState, 'botAdmins' | 'platform' | 'platformFields'>,
    value: string,
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Switching platforms resets credential fields AND verification state
  const handlePlatformChange = (value: string) => {
    resetVerification()
    setForm((prev) => ({
      ...prev,
      platform: value as Platform,
      platformFields: INITIAL_PLATFORM_FIELDS,
    }))
  }

  // Changing any credential field invalidates the previous verification result
  const handlePlatformField = (key: keyof PlatformFields, value: string) => {
    resetVerification()
    setForm((prev) => ({
      ...prev,
      platformFields: { ...prev.platformFields, [key]: value },
    }))
  }

  // ── Admin array handlers ─────────────────────────────────────────────────

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
      // Keep at least one row so the field is never completely absent
      botAdmins:
        prev.botAdmins.length > 1
          ? prev.botAdmins.filter((_, i) => i !== index)
          : prev.botAdmins,
    }))
  }

  // ── Verify ───────────────────────────────────────────────────────────────

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
    }
    validate(credentials)
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (!form.platform) return
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
    }
    void createBot({
      botNickname: form.botNickname,
      botPrefix: form.botPrefix,
      botAdmins: form.botAdmins.filter((a) => a.trim() !== ''),
      credentials,
    })
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const platformLabelName = form.platform
    ? getPlatformLabel(form.platform)
    : form.platform

  const credentialSummary: { label: string; value: string }[] = (() => {
    switch (form.platform) {
      case Platforms.Discord:
        return [
          { label: 'Discord Token', value: form.platformFields.discordToken },
        ]
      case Platforms.Telegram:
        return [
          { label: 'Telegram Token', value: form.platformFields.telegramToken },
        ]
      case Platforms.FacebookPage:
        return [
          {
            label: 'FB Page Access Token',
            value: form.platformFields.fbPageAccessToken,
          },
          { label: 'FB Page ID', value: form.platformFields.fbPageId },
        ]
      case Platforms.FacebookMessenger:
        return [{ label: 'Appstate', value: form.platformFields.appstate }]
      default:
        return []
    }
  })()

  const filledAdmins = form.botAdmins.filter((a) => a.trim())

  // While the FB Page OTP flow is in progress the user is waiting for async events;
  // the Verify/Next button must not be shown during this window.
  const isFbPageWaiting =
    verificationStatus.phase === 'fbpage-webhook-pending' ||
    verificationStatus.phase === 'fbpage-otp-pending'

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      {/* Sets the browser tab title for the new-bot creation wizard */}
      <Helmet>
        <title>Create New Bot · Cat-Bot</title>
      </Helmet>
      {/* Page header */}
      <div>
        <h1 className="text-headline-md font-semibold text-on-surface">
          Create New Bot
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Configure your bot's identity and platform credentials.
        </p>
      </div>

      <Steps.Root count={3} step={currentStep} onStepChange={handleStepChange}>
        {/* Step progress indicator */}
        <Steps.List>
          <Steps.Item index={0}>
            <Steps.Trigger index={0}>
              <Steps.Indicator index={0} />
              <div className="flex flex-col">
                <Steps.Title>Identity</Steps.Title>
                <Steps.Description>Nickname & admins</Steps.Description>
              </div>
            </Steps.Trigger>
          </Steps.Item>

          <Steps.Separator index={0} />

          <Steps.Item index={1}>
            <Steps.Trigger index={1}>
              <Steps.Indicator index={1} />
              <div className="flex flex-col">
                <Steps.Title>Platform</Steps.Title>
                <Steps.Description>Credentials</Steps.Description>
              </div>
            </Steps.Trigger>
          </Steps.Item>

          <Steps.Separator index={1} />

          <Steps.Item index={2}>
            <Steps.Trigger index={2}>
              <Steps.Indicator index={2} />
              <div className="flex flex-col">
                <Steps.Title>Review</Steps.Title>
                <Steps.Description>Confirm & create</Steps.Description>
              </div>
            </Steps.Trigger>
          </Steps.Item>
        </Steps.List>

        {/* ── Step 1: Bot Identity ──────────────────────────────────────────── */}
        <Steps.Content index={0}>
          <Card.Root variant="elevated" shadowElevation={1} padding="md">
            <Card.Header>
              <div>
                <Card.Title as="h2">Bot Identity</Card.Title>
                <Card.Description>
                  Basic information about your bot.
                </Card.Description>
              </div>
            </Card.Header>

            <div className="flex flex-col gap-5">
              <Field.Root required>
                <Field.Label>Bot Nickname</Field.Label>
                <Input
                  placeholder="e.g. Cat Bot"
                  value={form.botNickname}
                  onChange={(e) =>
                    handleTopField('botNickname', e.target.value)
                  }
                />
              </Field.Root>

              <Field.Root required>
                <Field.Label>Bot Prefix</Field.Label>
                <Input
                  placeholder="e.g. /"
                  value={form.botPrefix}
                  onChange={(e) => handleTopField('botPrefix', e.target.value)}
                />
              </Field.Root>

              {/* Admin section — grouped in a tinted container so the repeating
                  inputs feel like a coherent list rather than floating fields */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-label-md font-medium text-on-surface">
                      Bot Admins
                    </p>
                    <p className="text-label-sm text-on-surface-variant mt-0.5">
                      User IDs with admin privileges
                    </p>
                  </div>
                  <Button
                    variant="text"
                    color="primary"
                    size="sm"
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                    onClick={handleAddAdmin}
                    aria-label="Add another admin user ID"
                  >
                    Add
                  </Button>
                </div>

                {/* Tinted container distinguishes the admin list */}
                <div className="flex flex-col gap-2 rounded-lg">
                  {form.botAdmins.map((adminId, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="flex-1">
                        <Input
                          placeholder={`Admin user ID ${index + 1}`}
                          value={adminId}
                          onChange={(e) =>
                            handleAdminChange(index, e.target.value)
                          }
                          aria-label={`Admin user ID ${index + 1}`}
                        />
                      </div>
                      {form.botAdmins.length > 1 && (
                        <Button
                          variant="text"
                          color="error"
                          iconOnly
                          onClick={() => handleRemoveAdmin(index)}
                          aria-label={`Remove admin user ID ${index + 1}`}
                          leftIcon={<Trash2 className="h-4 w-4" />}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Card.Footer keeps action buttons inside the card boundary */}
            <Card.Footer align="between">
              <Button
                variant="text"
                color="neutral"
                size="md"
                onClick={() => navigate(ROUTES.DASHBOARD.ROOT)}
              >
                Cancel
              </Button>
              <Button
                variant="filled"
                color="primary"
                size="md"
                onClick={() => handleStepChange(1)}
                disabled={!isStep1Valid}
              >
                Next
              </Button>
            </Card.Footer>
          </Card.Root>
        </Steps.Content>

        {/* ── Step 2: Platform + Credential Verification ───────────────────── */}
        <Steps.Content index={1}>
          <Card.Root variant="elevated" shadowElevation={1} padding="md">
            <Card.Header>
              <div>
                <Card.Title as="h2">Platform</Card.Title>
                <Card.Description>
                  Select the messaging platform, provide credentials, then click{' '}
                  <strong>Verify</strong> to validate before proceeding.
                </Card.Description>
              </div>
            </Card.Header>

            <div className="flex flex-col gap-5">
              <Field.Root required>
                <Field.Label>Platform</Field.Label>
                <Select
                  options={PLATFORM_OPTIONS}
                  placeholder="Select a platform"
                  value={form.platform}
                  onChange={handlePlatformChange}
                />
              </Field.Root>

              {/* Credential inputs appear once a platform is selected */}
              {form.platform && (
                <div
                  className="flex flex-col gap-5"
                  style={{
                    animation:
                      'fade-in-down 150ms var(--easing-standard-decelerate) both',
                  }}
                >
                  <Divider spacing="none" />
                  <PlatformFieldInputs
                    platform={form.platform}
                    fields={form.platformFields}
                    onChange={handlePlatformField}
                  />
                </div>
              )}

              {/* Verification feedback appears once the user initiates verification */}
              {verificationStatus.phase !== 'idle' && form.platform && (
                <div className="flex flex-col gap-3">
                  <Divider spacing="none" />
                  <VerificationStatusDisplay status={verificationStatus} />
                </div>
              )}
            </div>

            <Card.Footer align="between">
              <Button
                variant="text"
                color="neutral"
                size="md"
                onClick={() => handleStepChange(0)}
              >
                Back
              </Button>

              {verificationStatus.phase === 'success' ? (
                <Button
                  variant="filled"
                  color="primary"
                  size="md"
                  onClick={() => handleStepChange(2)}
                >
                  Next
                </Button>
              ) : isFbPageWaiting ? null : (
                <Button
                  variant="filled"
                  color="primary"
                  size="md"
                  onClick={handleVerify}
                  disabled={
                    !canVerify || verificationStatus.phase === 'validating'
                  }
                >
                  {verificationStatus.phase === 'validating'
                    ? 'Verifying…'
                    : 'Verify'}
                </Button>
              )}
            </Card.Footer>
          </Card.Root>
        </Steps.Content>

        {/* ── Step 3: Review & Create ──────────────────────────────────────── */}
        <Steps.Content index={2}>
          <Card.Root variant="elevated" shadowElevation={1} padding="md">
            <Card.Header>
              <div>
                <Card.Title as="h2">Review</Card.Title>
                <Card.Description>
                  Verify your configuration before creating the bot.
                </Card.Description>
              </div>
            </Card.Header>

            <div className="flex flex-col gap-4">
              {/* Identity group */}
              <div>
                <p className="text-label-sm font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                  Identity
                </p>
                <DataList.Root orientation="horizontal" size="md" divideY>
                  <DataList.Item>
                    <DataList.ItemLabel width="140px">
                      Nickname
                    </DataList.ItemLabel>
                    <DataList.ItemValue>{form.botNickname}</DataList.ItemValue>
                  </DataList.Item>
                  <DataList.Item>
                    <DataList.ItemLabel width="140px">
                      Prefix
                    </DataList.ItemLabel>
                    <DataList.ItemValue className="font-mono">
                      {form.botPrefix}
                    </DataList.ItemValue>
                  </DataList.Item>
                  <DataList.Item>
                    <DataList.ItemLabel width="140px">
                      Admins ({filledAdmins.length})
                    </DataList.ItemLabel>
                    <DataList.ItemValue>
                      <div className="flex flex-wrap gap-1.5">
                        {filledAdmins.map((id, i) => (
                          <span
                            key={i}
                            className="inline-block rounded-md bg-surface-container-high px-2 py-0.5 text-body-sm text-on-surface font-mono"
                          >
                            {id}
                          </span>
                        ))}
                      </div>
                    </DataList.ItemValue>
                  </DataList.Item>
                  <DataList.Item>
                    <DataList.ItemLabel width="140px">
                      Platform
                    </DataList.ItemLabel>
                    <DataList.ItemValue>{platformLabelName}</DataList.ItemValue>
                  </DataList.Item>
                </DataList.Root>
              </div>

              {/* Credentials group — separated with a labeled divider */}
              {credentialSummary.length > 0 && (
                <>
                  <Divider label="Credentials" spacing="none" />
                  <DataList.Root orientation="horizontal" size="md" divideY>
                    {credentialSummary.map((cred) => (
                      <DataList.Item key={cred.label}>
                        <DataList.ItemLabel width="140px">
                          {cred.label}
                        </DataList.ItemLabel>
                        <DataList.ItemValue className="font-mono break-all">
                          {maskCredential(cred.value)}
                        </DataList.ItemValue>
                      </DataList.Item>
                    ))}
                  </DataList.Root>
                </>
              )}

              {/* Creation error — shown inline above the submit button */}
              {botError !== null && (
                <Alert
                  variant="tonal"
                  color="error"
                  title="Creation Failed"
                  message={botError}
                />
              )}
            </div>

            <Card.Footer align="between">
              <Button
                variant="text"
                color="neutral"
                size="md"
                onClick={() => handleStepChange(1)}
              >
                Back
              </Button>
              {/* isLoading shows the built-in spinner and disables the button;
                  no need for a separate loading text string */}
              <Button
                variant="filled"
                color="primary"
                size="md"
                onClick={handleSubmit}
                isLoading={isLoading}
                disabled={isLoading}
              >
                Create Bot
              </Button>
            </Card.Footer>
          </Card.Root>
        </Steps.Content>
      </Steps.Root>
    </div>
  )
}
