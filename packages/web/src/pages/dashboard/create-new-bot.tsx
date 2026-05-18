import React, { useState } from 'react'
import { Helmet } from '@dr.pogodin/react-helmet'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Check } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Select from '@/components/ui/forms/Select'
import type { SelectOption } from '@/components/ui/forms/Select'
import Alert from '@/components/ui/feedback/Alert'
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
import { cn } from '@/utils/cn.util'

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

const STEPS = [
  { index: 0, label: 'Identity' },
  { index: 1, label: 'Platform' },
  { index: 2, label: 'Review' },
]

export default function NewBotPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [currentStep, setStep] = useState(0)
  const { isLoading, error: botError, createBot } = useBotCreate()
  const {
    status: verificationStatus,
    validate,
    reset: resetVerification,
  } = useBotValidation()

  const isStep1Valid =
    form.botNickname.trim() !== '' && form.botPrefix.trim() !== ''

  const isStep2Valid =
    form.platform !== '' &&
    verificationStatus.phase === 'success' &&
    (form.platform === Platforms.FacebookPage ||
      form.botAdmins.some((a) => a.trim() !== ''))

  const goTo = (step: number) => {
    if (step <= currentStep) {
      setStep(step)
      return
    }

    if (step !== currentStep + 1) return
    if (currentStep === 0 && !isStep1Valid) return
    if (currentStep === 1 && !isStep2Valid) return

    setStep(step)
  }

  const setTopField = (
    key: keyof Omit<FormState, 'botAdmins' | 'platform' | 'platformFields'>,
    val: string,
  ) => setForm((p) => ({ ...p, [key]: val }))

  const setPlatform = (val: string) => {
    resetVerification()
    setForm((p) => ({
      ...p,
      platform: val as Platform,
      platformFields: INITIAL_PLATFORM_FIELDS,
    }))
  }

  const setPlatformField = (key: keyof PlatformFields, val: string) => {
    resetVerification()
    setForm((p) => ({
      ...p,
      platformFields: { ...p.platformFields, [key]: val },
    }))
  }

  const setAdmin = (i: number, val: string) =>
    setForm((p) => {
      const admins = [...p.botAdmins]
      admins[i] = val
      return { ...p, botAdmins: admins }
    })

  const addAdmin = () =>
    setForm((p) => ({ ...p, botAdmins: [...p.botAdmins, ''] }))

  const removeAdmin = (i: number) =>
    setForm((p) => ({
      ...p,
      botAdmins:
        p.botAdmins.length > 1
          ? p.botAdmins.filter((_, idx) => idx !== i)
          : p.botAdmins,
    }))

  const canVerify = (() => {
    const f = form.platformFields

    switch (form.platform) {
      case Platforms.Discord:
        return !!f.discordToken
      case Platforms.Telegram:
        return !!f.telegramToken
      case Platforms.FacebookPage:
        return !!f.fbPageAccessToken && !!f.fbPageId
      case Platforms.FacebookMessenger:
        return !!f.appstate.trim()
      default:
        return false
    }
  })()

  const handleVerify = () => {
    if (!form.platform || !canVerify) return

    let creds: PlatformCredentials

    switch (form.platform) {
      case Platforms.Discord:
        creds = {
          platform: Platforms.Discord,
          discordToken: form.platformFields.discordToken,
        }
        break
      case Platforms.Telegram:
        creds = {
          platform: Platforms.Telegram,
          telegramToken: form.platformFields.telegramToken,
        }
        break
      case Platforms.FacebookPage:
        creds = {
          platform: Platforms.FacebookPage,
          fbAccessToken: form.platformFields.fbPageAccessToken,
          fbPageId: form.platformFields.fbPageId,
        }
        break
      case Platforms.FacebookMessenger:
        creds = {
          platform: Platforms.FacebookMessenger,
          appstate: form.platformFields.appstate,
        }
        break
    }

    validate(creds)
  }

  const handleSubmit = () => {
    if (!form.platform) return

    let creds: PlatformCredentials

    switch (form.platform) {
      case Platforms.Discord:
        creds = {
          platform: Platforms.Discord,
          discordToken: form.platformFields.discordToken,
        }
        break
      case Platforms.Telegram:
        creds = {
          platform: Platforms.Telegram,
          telegramToken: form.platformFields.telegramToken,
        }
        break
      case Platforms.FacebookPage:
        creds = {
          platform: Platforms.FacebookPage,
          fbAccessToken: form.platformFields.fbPageAccessToken,
          fbPageId: form.platformFields.fbPageId,
        }
        break
      case Platforms.FacebookMessenger:
        creds = {
          platform: Platforms.FacebookMessenger,
          appstate: form.platformFields.appstate,
        }
        break
    }

    void createBot({
      botNickname: form.botNickname,
      botPrefix: form.botPrefix,
      botAdmins:
        form.platform === Platforms.FacebookPage
          ? []
          : form.botAdmins.filter((a) => a.trim() !== ''),
      credentials: creds,
    })
  }

  const isFbPage = form.platform === Platforms.FacebookPage
  const platformLabel = form.platform ? getPlatformLabel(form.platform) : ''

  const credentialSummary: { label: string; value: string }[] = (() => {
    switch (form.platform) {
      case Platforms.Discord:
        return [{ label: 'Discord Token', value: form.platformFields.discordToken }]
      case Platforms.Telegram:
        return [
          { label: 'Telegram Token', value: form.platformFields.telegramToken },
        ]
      case Platforms.FacebookPage:
        return [
          {
            label: 'Page Access Token',
            value: form.platformFields.fbPageAccessToken,
          },
          { label: 'Page ID', value: form.platformFields.fbPageId },
        ]
      case Platforms.FacebookMessenger:
        return [{ label: 'Appstate', value: form.platformFields.appstate }]
      default:
        return []
    }
  })()

  const filledAdmins = form.botAdmins.filter((a) => a.trim())

  const isFbPageWaiting =
    verificationStatus.phase === 'fbpage-webhook-pending' ||
    verificationStatus.phase === 'fbpage-otp-pending'

  return (
    <div className="w-full max-w-[520px] mx-auto min-w-0">
      <Helmet>
        <title>Create New Bot · Cat-Bot</title>
      </Helmet>

      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-on-surface-variant/60 mb-2 select-none">
          Cat-Bot Dashboard
        </p>
        <h1 className="text-[1.5rem] font-bold tracking-tight text-on-surface leading-tight">
          Create New Bot
        </h1>
        <p className="mt-2 text-sm text-on-surface-variant leading-relaxed max-w-sm">
          Set up your bot in three steps. Each field is verified before you proceed.
        </p>
      </div>

      <WizardStepper steps={STEPS} current={currentStep} onGoTo={goTo} />

      <div className="mt-5">
        {currentStep === 0 && (
          <WizardCard
            title="Bot Identity"
            description="Give your bot a name and choose a command trigger prefix."
          >
            <FormBody>
              <Field.Root required>
                <Field.Label>Nickname</Field.Label>
                <Input
                  placeholder="e.g. Cat Bot"
                  value={form.botNickname}
                  onChange={(e) => setTopField('botNickname', e.target.value)}
                  autoFocus
                />
                <Field.HelperText>
                  Displayed as the bot's identity in your dashboard.
                </Field.HelperText>
              </Field.Root>

              <Field.Root required>
                <Field.Label>Command Prefix</Field.Label>
                <Input
                  placeholder="e.g. /"
                  value={form.botPrefix}
                  onChange={(e) => setTopField('botPrefix', e.target.value)}
                />
                <Field.HelperText>
                  The character users type before a command, e.g.{' '}
                  <code className="font-mono text-on-surface bg-surface-container-high rounded px-1 py-px text-xs">
                    /help
                  </code>
                  .
                </Field.HelperText>
              </Field.Root>
            </FormBody>

            <WizardFooter
              onBack={() => navigate(ROUTES.DASHBOARD.ROOT)}
              backLabel="Cancel"
              onNext={() => goTo(1)}
              nextLabel="Continue"
              nextDisabled={!isStep1Valid}
            />
          </WizardCard>
        )}

        {currentStep === 1 && (
          <WizardCard
            title="Platform & Credentials"
            description="Choose a messaging platform and provide the required credentials. Tap Verify before continuing."
          >
            <FormBody>
              <Field.Root required>
                <Field.Label>Platform</Field.Label>
                <Select
                  options={PLATFORM_OPTIONS}
                  placeholder="Select a platform"
                  value={form.platform}
                  onChange={setPlatform}
                />
              </Field.Root>

              {form.platform && (
                <div
                  className="flex flex-col gap-5"
                  style={{
                    animation:
                      'fade-in-blur 220ms cubic-bezier(0.2,0,0,1) both',
                  }}
                >
                  <FieldGroup label="Credentials">
                    <PlatformFieldInputs
                      platform={form.platform}
                      fields={form.platformFields}
                      onChange={setPlatformField}
                    />
                  </FieldGroup>

                  {!isFbPage ? (
                    <FieldGroup
                      label="Bot Admins"
                      hint="User IDs that have admin control over this bot."
                      action={
                        <button
                          type="button"
                          onClick={addAdmin}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </button>
                      }
                    >
                      <div className="flex flex-col gap-2.5">
                        {form.botAdmins.map((id, i) => (
                          <div key={i} className="flex items-center gap-2 min-w-0">
                            <div className="flex-1 min-w-0">
                              <Input
                                placeholder={`User ID ${i + 1}`}
                                value={id}
                                onChange={(e) => setAdmin(i, e.target.value)}
                                aria-label={`Admin user ID ${i + 1}`}
                              />
                            </div>

                            {form.botAdmins.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeAdmin(i)}
                                aria-label={`Remove admin ${i + 1}`}
                                className={cn(
                                  'shrink-0 h-9 w-9 flex items-center justify-center rounded-lg',
                                  'text-on-surface-variant hover:text-error hover:bg-error/10',
                                  'transition-all duration-150',
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/30',
                                )}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </FieldGroup>
                  ) : (
                    <Alert
                      variant="tonal"
                      color="info"
                      title="Admin access via Meta roles"
                      message="Admin IDs are not required for Facebook Pages. Access is managed through your Meta Page roles using PSIDs."
                    />
                  )}

                  {verificationStatus.phase !== 'idle' && (
                    <VerificationStatusDisplay status={verificationStatus} />
                  )}
                </div>
              )}
            </FormBody>

            <WizardFooter
              onBack={() => goTo(0)}
              backLabel="Back"
              onNext={
                verificationStatus.phase === 'success'
                  ? () => goTo(2)
                  : isFbPageWaiting
                    ? undefined
                    : handleVerify
              }
              nextLabel={
                verificationStatus.phase === 'success'
                  ? 'Continue'
                  : verificationStatus.phase === 'validating'
                    ? 'Verifying…'
                    : 'Verify'
              }
              nextDisabled={
                verificationStatus.phase === 'success'
                  ? false
                  : !canVerify || verificationStatus.phase === 'validating'
              }
              nextLoading={verificationStatus.phase === 'validating'}
            />
          </WizardCard>
        )}

        {currentStep === 2 && (
          <WizardCard
            title="Review & Confirm"
            description="Check your configuration carefully. Go back to edit before creating."
          >
            <FormBody>
              <ReviewGroup title="Identity">
                <ReviewRow label="Nickname" value={form.botNickname} />
                <ReviewRow label="Prefix" value={form.botPrefix} mono />
                <ReviewRow label="Platform" value={platformLabel} />

                {!isFbPage && filledAdmins.length > 0 && (
                  <ReviewRow label={`Admins (${filledAdmins.length})`} value="">
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {filledAdmins.map((id, i) => (
                        <AdminBadge key={i}>{id}</AdminBadge>
                      ))}
                    </div>
                  </ReviewRow>
                )}
              </ReviewGroup>

              {credentialSummary.length > 0 && (
                <ReviewGroup title="Credentials">
                  {credentialSummary.map((c) => (
                    <ReviewRow
                      key={c.label}
                      label={c.label}
                      value={maskCredential(c.value)}
                      mono
                    />
                  ))}
                </ReviewGroup>
              )}

              {botError !== null && (
                <Alert
                  variant="tonal"
                  color="error"
                  title="Creation Failed"
                  message={botError}
                />
              )}
            </FormBody>

            <WizardFooter
              onBack={() => goTo(1)}
              backLabel="Back"
              onNext={handleSubmit}
              nextLabel="Create Bot"
              nextLoading={isLoading}
              nextDisabled={isLoading}
            />
          </WizardCard>
        )}
      </div>
    </div>
  )
}

function WizardStepper({
  steps,
  current,
  onGoTo,
}: {
  steps: { index: number; label: string }[]
  current: number
  onGoTo: (i: number) => void
}) {
  return (
    <Card.Root variant="elevated" shadowElevation={1} padding="md">
      <div className="flex items-center w-full">
        {steps.map((step, idx) => {
          const isDone = current > step.index
          const isActive = current === step.index
          const isLocked = step.index > current

          return (
            <React.Fragment key={step.index}>
              <button
                type="button"
                onClick={() => onGoTo(step.index)}
                disabled={isLocked}
                aria-label={`Step ${step.index + 1}: ${step.label}`}
                aria-current={isActive ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2.5 shrink-0 rounded-lg',
                  'transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                  isLocked
                    ? 'opacity-35 cursor-not-allowed'
                    : 'cursor-pointer hover:opacity-75',
                )}
              >
                <span
                  className={cn(
                    'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    'text-[11px] font-bold tracking-tight transition-all duration-300',
                    isDone || isActive
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant',
                  )}
                  style={
                    isDone || isActive
                      ? {
                          boxShadow:
                            '0 0 0 3px rgba(138,180,255,0.18), 0 0 12px rgba(138,180,255,0.12)',
                        }
                      : { border: '1.5px solid rgba(255,255,255,0.16)' }
                  }
                >
                  {isDone ? (
                    <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                  ) : (
                    step.index + 1
                  )}
                </span>

                <span
                  className={cn(
                    'hidden sm:block text-sm whitespace-nowrap transition-colors duration-200',
                    isActive
                      ? 'font-semibold text-on-surface'
                      : isDone
                        ? 'font-medium text-primary'
                        : 'font-medium text-on-surface-variant',
                  )}
                >
                  {step.label}
                </span>
              </button>

              {idx < steps.length - 1 && (
                <ProgressConnector filled={current > idx} />
              )}
            </React.Fragment>
          )
        })}
      </div>

      <div className="sm:hidden mt-3.5 flex items-center justify-center gap-2">
        <span className="text-[11px] text-on-surface-variant/60 leading-none">
          Step {current + 1} of {steps.length}
        </span>
        <span className="h-3 w-px rounded-full bg-on-surface-variant/20" />
        <span className="text-[11px] font-semibold text-on-surface leading-none">
          {steps[current].label}
        </span>
      </div>
    </Card.Root>
  )
}

function ProgressConnector({ filled }: { filled: boolean }) {
  return (
    <div className="flex-1 mx-3 sm:mx-4 relative h-[2px] rounded-full overflow-hidden">
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: 'rgba(255,255,255,0.08)' }}
      />
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
        style={{
          width: filled ? '100%' : '0%',
          background:
            'linear-gradient(90deg, rgba(138,180,255,0.55) 0%, rgba(138,180,255,0.85) 100%)',
          boxShadow: filled ? '0 0 6px rgba(138,180,255,0.4)' : 'none',
        }}
      />
    </div>
  )
}

function WizardCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card.Root variant="elevated" shadowElevation={1} padding="md">
      <Card.Header>
        <div>
          <Card.Title as="h2">{title}</Card.Title>
          <Card.Description>{description}</Card.Description>
        </div>
      </Card.Header>

      <div className="flex flex-col gap-6">{children}</div>
    </Card.Root>
  )
}

function FormBody({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>
}

function WizardFooter({
  onBack,
  backLabel = 'Back',
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  nextLoading = false,
}: {
  onBack?: () => void
  backLabel?: string
  onNext?: () => void
  nextLabel?: string
  nextDisabled?: boolean
  nextLoading?: boolean
}) {
  return (
    <Card.Footer align="between">
      <Button
        variant="text"
        color="neutral"
        size="md"
        onClick={onBack}
        className="min-w-[72px]"
      >
        {backLabel}
      </Button>

      {onNext && (
        <Button
          variant="filled"
          color="primary"
          size="md"
          onClick={onNext}
          disabled={nextDisabled}
          isLoading={nextLoading}
          className="min-w-[108px]"
        >
          {nextLabel}
        </Button>
      )}
    </Card.Footer>
  )
}

function FieldGroup({
  label,
  hint,
  action,
  children,
}: {
  label: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-semibold text-on-surface leading-snug">
            {label}
          </span>
          {hint && (
            <span className="text-xs text-on-surface-variant leading-relaxed">
              {hint}
            </span>
          )}
        </div>
        {action && <div className="shrink-0 pt-0.5">{action}</div>}
      </div>

      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}

function ReviewGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-on-surface-variant/55 select-none">
        {title}
      </p>

      <div
        className="rounded-xl overflow-hidden flex flex-col"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function ReviewRow({
  label,
  value,
  mono = false,
  children,
}: {
  label: string
  value: string
  mono?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className="flex flex-col gap-1 px-4 py-3.5 [&+&]:border-t"
      style={{ borderColor: 'rgba(255,255,255,0.055)' }}
    >
      <span className="text-[11px] font-medium text-on-surface-variant leading-none tracking-wide uppercase">
        {label}
      </span>

      {children ?? (
        <span
          className={cn(
            'text-sm text-on-surface break-all leading-snug',
            mono ? 'font-mono' : 'font-medium',
          )}
        >
          {value || (
            <span className="text-on-surface-variant/50 italic text-xs font-normal">
              —
            </span>
          )}
        </span>
      )}
    </div>
  )
}

function AdminBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono text-on-surface break-all leading-none"
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)',
      }}
    >
      {children}
    </span>
  )
}