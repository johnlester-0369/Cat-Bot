import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Switch from '@/components/ui/forms/Switch'
import ClipboardButton from '@/components/ui/forms/ClipboardButton'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Status from '@/components/ui/data-display/Status'
import DataList from '@/components/ui/data-display/DataList'
import { useTheme } from '@/contexts/ThemeContext'
import Divider from '@/components/ui/layout/Divider'
import { toggleTheme } from '@/utils/theme.util'
import { useFbWebhook } from '@/features/users/hooks/useFbWebhook'
// better-auth exposes updateUser and changePassword as built-in client functions —
// no custom server endpoints needed; toNodeHandler(auth) in server/app.ts already
// mounts /api/auth/update-user and /api/auth/change-password automatically.
import { authUserClient } from '@/lib/better-auth-client.lib'
import apiClient from '@/lib/api-client.lib'

// ============================================================================
// Page
// ============================================================================

/**
 * Settings page — four sections:
 *  1. Appearance  — live theme toggle wired to ThemeContext
 *  2. Profile     — real user name from better-auth session; editable via updateUser()
 *  3. Facebook Page Webhook — webhook URL + verify token with clipboard copy
 *  4. Security    — change password via better-auth changePassword() built-in
 */
export default function SettingsPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'
  const { theme, setTheme } = useTheme()
  const { data: webhookData, isLoading: webhookLoading } = useFbWebhook()

  // Real session data — better-auth useSession() hook returns { data, isPending, error }
  const { data: session, isPending: sessionLoading } =
    authUserClient.useSession()

  // ── Profile edit state ─────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState('')
  // nameInitialized prevents overwriting user edits when the session re-renders
  const [nameInitialized, setNameInitialized] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)

  // Seed the input from session once on first load; subsequent renders skip this
  if (session?.user?.name && !nameInitialized) {
    setProfileName(session.user.name)
    setNameInitialized(true)
  }

  const handleUpdateProfile = async (): Promise<void> => {
    if (!profileName.trim()) {
      setProfileError('Name cannot be empty')
      return
    }
    setProfileSaving(true)
    setProfileError(null)
    setProfileSuccess(false)

    const { error } = await authUserClient.updateUser({
      name: profileName.trim(),
    })
    if (error) {
      setProfileError(error.message ?? 'Failed to update profile')
    } else {
      setProfileSuccess(true)
      // Auto-dismiss the success banner after 3 s so it does not linger
      setTimeout(() => setProfileSuccess(false), 3000)
    }
    setProfileSaving(false)
  }

  // ── Password change state ──────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleChangePassword = async (): Promise<void> => {
    setPasswordError(null)
    setPasswordSuccess(false)

    // Client-side guard — avoids a round-trip for obvious mismatches
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }

    setPasswordSaving(true)
    const { error } = await authUserClient.changePassword({
      currentPassword,
      newPassword,
      // Revoke all other sessions so stolen session cookies are immediately invalidated
      revokeOtherSessions: true,
    })

    if (error) {
      setPasswordError(error.message ?? 'Failed to change password')
    } else {
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(false), 3000)
    }
    setPasswordSaving(false)
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto pb-12">
      {/* Sets the browser tab title for the user settings page */}
      <Helmet>
        <title>Settings · Cat-Bot</title>
      </Helmet>
      {/* Page header */}
      <div>
        <h1 className="text-headline-md font-semibold text-on-surface">
          Settings
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Manage your preferences and account configuration.
        </p>
      </div>

      {/* ── Appearance ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div className="flex items-center gap-3">
            <div>
              <Card.Title as="h2">Appearance</Card.Title>
              <Card.Description>
                Customize how Cat-Bot looks for you.
              </Card.Description>
            </div>
          </div>
        </Card.Header>

        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low border border-outline-variant/50 px-4 py-3.5">
          <p className="text-body-md font-medium text-on-surface">Dark mode</p>
          <Switch
            checked={theme === 'dark'}
            onChange={() => setTheme(toggleTheme(theme))}
          />
        </div>
      </Card.Root>

      {/* ── Profile ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div className="flex items-center gap-3">
            <div>
              <Card.Title as="h2">Profile</Card.Title>
              <Card.Description>
                Update your display name and account information.
              </Card.Description>
            </div>
          </div>
        </Card.Header>

        <div className="flex flex-col gap-5">
          {/* Email — display-only; read-only DataList row matches the design system's key-value pattern */}
          <DataList.Root size="sm">
            <DataList.Item>
              <DataList.ItemLabel>Email</DataList.ItemLabel>
              <DataList.ItemValue>
                {sessionLoading ? (
                  <Skeleton textSize="body-sm" width="55%" />
                ) : (
                  <span className="text-body-sm font-medium text-on-surface">
                    {session?.user?.email ?? '—'}
                  </span>
                )}
              </DataList.ItemValue>
            </DataList.Item>
          </DataList.Root>

          {/* Editable display name — Save button inline so the action is right beside the input */}
          <Field.Root>
            <Field.Label>Display name</Field.Label>
            <div className="flex gap-2">
              <Input
                value={profileName}
                onChange={(e) => {
                  setProfileName(e.target.value)
                  setProfileError(null)
                  setProfileSuccess(false)
                }}
                placeholder={sessionLoading ? 'Loading…' : 'Your name'}
                disabled={sessionLoading || profileSaving}
              />
              <Button
                variant="tonal"
                color="primary"
                size="md"
                onClick={() => {
                  void handleUpdateProfile()
                }}
                disabled={sessionLoading || profileSaving}
                isLoading={profileSaving}
                className="flex-shrink-0"
              >
                Save
              </Button>
            </div>
          </Field.Root>

          {/* Feedback — Alert replaces plain <p> for consistent visual weight */}
          {profileError && (
            <Alert
              variant="tonal"
              color="error"
              title={profileError}
              size="sm"
            />
          )}
          {profileSuccess && (
            <Alert
              variant="tonal"
              color="success"
              title="Profile updated successfully."
              size="sm"
            />
          )}
        </div>
      </Card.Root>

      {/* ── Facebook Page Webhook ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div className="flex items-center gap-3">
            <div>
              <Card.Title as="h2">Facebook Page Webhook</Card.Title>
              <Card.Description>
                Webhook endpoint and token for your Facebook Page integration.
              </Card.Description>
            </div>
          </div>

          {/* Verification status — Status component replaces the Badge used before */}
          {!webhookLoading && webhookData && (
            <Status.Root
              colorPalette={webhookData.isVerified ? 'success' : 'warning'}
              size="sm"
              className="flex-shrink-0"
            >
              <Status.Indicator
                colorPalette={webhookData.isVerified ? 'success' : 'warning'}
                // Pulse on pending so the operator knows the webhook is awaiting Facebook's handshake
                pulse={!webhookData.isVerified}
              />
              {webhookData.isVerified ? 'Verified' : 'Pending'}
            </Status.Root>
          )}
        </Card.Header>

        <div className="flex flex-col gap-4">
          {/* Webhook URL — read-only + clipboard copy side by side */}
          <Field.Root>
            <Field.Label>Webhook URL</Field.Label>
            {webhookLoading ? (
              <Skeleton variant="rounded" height={44} />
            ) : (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookData?.webhookUrl ?? ''}
                  className="font-mono"
                />
                <ClipboardButton
                  text={webhookData?.webhookUrl ?? ''}
                  size="md"
                  aria-label="Copy webhook URL"
                  disabled={!webhookData?.webhookUrl}
                  className="flex-shrink-0"
                />
              </div>
            )}
          </Field.Root>

          {/* Verify Token — same pattern as webhook URL */}
          <Field.Root>
            <Field.Label>Verify Token</Field.Label>
            {webhookLoading ? (
              <Skeleton variant="rounded" height={44} />
            ) : (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookData?.verifyToken ?? ''}
                  className="font-mono"
                />
                <ClipboardButton
                  text={webhookData?.verifyToken ?? ''}
                  size="md"
                  aria-label="Copy verify token"
                  disabled={!webhookData?.verifyToken}
                  className="flex-shrink-0"
                />
              </div>
            )}
          </Field.Root>
        </div>
      </Card.Root>

      {/* ── Security — Change Password ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div className="flex items-center gap-3">
            <div>
              <Card.Title as="h2">Security</Card.Title>
              <Card.Description>
                Change your password. All other sessions will be signed out on
                success.
              </Card.Description>
            </div>
          </div>
        </Card.Header>

        <div className="flex flex-col gap-4">
          {isEmailEnabled && (
            <>
              {/* Allow operators to send a quick reset link straight from their active session without needing to remember their current password */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/50">
                <div>
                  <p className="text-label-lg font-medium text-on-surface">Password Reset</p>
                  <p className="text-body-sm text-on-surface-variant">Send a secure reset link to your email address.</p>
                </div>
                <Button
                  variant="tonal"
                  color="primary"
                  size="sm"
                  onClick={async () => {
                    setResetSent(true)
                    // Target the custom HMAC token flow that powers the Forgot Password page
                    // instead of better-auth's default implementation.
                    await apiClient.post('/api/v1/validate/reset-password/request', {
                      email: session?.user?.email || '',
                      adminOnly: false,
                    })
                  }}
                  disabled={resetSent}
                >
                  {resetSent ? 'Link Sent' : 'Send Reset Link'}
                </Button>
              </div>
              {resetSent && (
                <Alert 
                  variant="tonal" 
                  color="success" 
                  title="Check your email" 
                  message="We've sent you a secure link to reset your password." 
                  size="sm" 
                />
              )}
              <Divider spacing="sm" />
            </>
          )}

          <Field.Root>
            <Field.Label>Current password</Field.Label>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value)
                setPasswordError(null)
              }}
              placeholder="Enter current password"
              disabled={passwordSaving}
            />
          </Field.Root>

          {/* Two-column grid on wider viewports to reduce vertical scroll */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field.Root>
              <Field.Label>New password</Field.Label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  setPasswordError(null)
                }}
                placeholder="At least 8 characters"
                disabled={passwordSaving}
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>Confirm new password</Field.Label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  setPasswordError(null)
                }}
                placeholder="Repeat new password"
                disabled={passwordSaving}
              />
            </Field.Root>
          </div>

          {/* Feedback — Alert replaces plain <p> for consistent visual weight */}
          {passwordError && (
            <Alert
              variant="tonal"
              color="error"
              title={passwordError}
              size="sm"
            />
          )}
          {passwordSuccess && (
            <Alert
              variant="tonal"
              color="success"
              title="Password changed successfully."
              message="All other sessions have been signed out."
              size="sm"
            />
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="filled"
              color="primary"
              size="sm"
              onClick={() => {
                void handleChangePassword()
              }}
              disabled={
                passwordSaving ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              isLoading={passwordSaving}
            >
              Change password
            </Button>
          </div>
        </div>
      </Card.Root>
    </div>
  )
}
