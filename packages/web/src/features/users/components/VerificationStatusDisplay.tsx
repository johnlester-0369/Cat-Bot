import { CheckCircle2 } from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import ClipboardButton from '@/components/ui/forms/ClipboardButton'
import type { ValidationStatus } from '@/features/users/hooks/useBotValidation'

export interface VerificationStatusDisplayProps {
  status: ValidationStatus
}

/**
 * Handles the multi-phase async UI rendering for credential verification.
 * Extracted to reduce the noise in the parent multi-step form wizard.
 */
export function VerificationStatusDisplay({
  status,
}: VerificationStatusDisplayProps) {
  if (status.phase === 'idle') return null

  if (status.phase === 'validating') {
    return (
      <p className="text-body-sm text-on-surface-variant animate-pulse">
        Verifying credentials…
      </p>
    )
  }

  if (status.phase === 'success') {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
        <span className="text-body-sm font-medium text-success">
          Credentials verified
        </span>
        {status.info && (
          <span className="text-body-sm text-on-surface-variant">
            ({status.info})
          </span>
        )}
      </div>
    )
  }

  if (status.phase === 'error') {
    return (
      <Alert
        variant="tonal"
        color="error"
        title="Verification Failed"
        message={status.message}
      />
    )
  }

  if (status.phase === 'fbpage-webhook-pending') {
    return (
      <div className="flex flex-col gap-4 rounded-lg bg-surface-container-low p-4">
        {/* Step 1: Webhook registration */}
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-label-md font-semibold text-on-surface">
              Step 1 — Register Webhook in Meta App Dashboard
            </p>
            <p className="text-body-sm text-on-surface-variant mt-0.5">
              Add the URL and verify token below to your Facebook App's webhook
              settings, then click Verify and Save.
            </p>
          </div>
          <Field.Root>
            <Field.Label>Webhook URL</Field.Label>
            {/* Wrap input in flex container to place clipboard button alongside it matching the pattern in settings.tsx */}
            <div className="flex gap-2">
              <Input readOnly value={status.webhookUrl} className="font-mono" />
              <ClipboardButton
                text={status.webhookUrl}
                size="md"
                aria-label="Copy webhook URL"
                className="flex-shrink-0"
              />
            </div>
          </Field.Root>
          <Field.Root>
            <Field.Label>Verify Token</Field.Label>
            <div className="flex gap-2">
              <Input readOnly value={status.verifyToken} className="font-mono" />
              <ClipboardButton
                text={status.verifyToken}
                size="md"
                aria-label="Copy verify token"
                className="flex-shrink-0"
              />
            </div>
          </Field.Root>
        </div>

        {/* Step 2: OTP delivery */}
        <div className="border-t border-outline-variant pt-4 flex flex-col gap-2">
          <p className="text-label-md font-semibold text-on-surface">
            Step 2 — Send OTP to your Facebook Page
          </p>
          <p className="text-body-sm text-on-surface-variant">
            After the webhook is verified, send this exact message to your
            Facebook Page:
          </p>
          {/* Allow 1-click copy of the OTP so the user doesn't have to manually highlight it */}
          <div className="flex items-center gap-4 py-2">
            <p className="font-mono text-3xl font-bold tracking-widest text-on-surface">
              {status.otp}
            </p>
            <ClipboardButton
              text={status.otp}
              size="md"
              aria-label="Copy OTP"
            />
          </div>
          <p className="text-body-sm text-on-surface-variant animate-pulse">
            Waiting for webhook verification…
          </p>
        </div>
      </div>
    )
  }

  if (status.phase === 'fbpage-otp-pending') {
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-4">
        <div>
          <p className="text-label-md font-semibold text-on-surface">
            Send OTP to your Facebook Page
          </p>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Type this message and send it directly to your Facebook Page to
            complete verification:
          </p>
        </div>
        <div className="flex items-center gap-4 py-2">
          <p className="font-mono text-3xl font-bold tracking-widest text-on-surface">
            {status.otp}
          </p>
          <ClipboardButton
            text={status.otp}
            size="md"
            aria-label="Copy OTP"
          />
        </div>
        <p className="text-body-sm text-on-surface-variant animate-pulse">
          Waiting for confirmation from Facebook…
        </p>
      </div>
    )
  }

  return null
}
