import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'

/**
 * Admin Reset Password page — requires token authorization in the URL.
 * Handles isolated admin password updates.
 */
export default function AdminResetPasswordPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'

  const [searchParams] = useSearchParams()
  // Safely trim any trailing whitespace or newline characters injected by strict email clients
  const token = searchParams.get('token')?.trim()
  // Extract email so we can provide a 1-click resend experience if token expires
  const emailParam = searchParams.get('email')?.trim()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<{
    password?: string
    confirmPassword?: string
  }>({})
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isValidating, setIsValidating] = useState(true)
  const [isTokenValid, setIsTokenValid] = useState(false)

  const [isResending, setIsResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setIsValidating(false)
      return
    }

    let isMounted = true
    const checkToken = async () => {
      try {
        const result = await apiClient.post<{ valid: boolean }>(
          '/api/v1/validate/reset-password/verify-token',
          {
            token,
            adminOnly: true,
          },
        )
        if (isMounted) setIsTokenValid(result.data.valid)
      } catch {
        if (isMounted) setIsTokenValid(false)
      } finally {
        if (isMounted) setIsValidating(false)
      }
    }
    void checkToken()
    return () => {
      isMounted = false
    }
  }, [token])

  const validate = () => {
    const newErrors: typeof errors = {}
    if (!password) {
      newErrors.password = 'Password is required.'
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters.'
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Confirmation is required.'
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match.'
    }

    return newErrors
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setIsLoading(true)

    try {
      await apiClient.post('/api/v1/validate/reset-password/confirm', {
        token,
        password,
        adminOnly: true,
      })
      setIsSubmitted(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setErrors({
        password: e.response?.data?.error || 'Failed to reset password.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (!emailParam) return
    setIsResending(true)
    setResendError(null)

    try {
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email: emailParam,
        adminOnly: true,
      })
      setResendSuccess(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setResendError(e.response?.data?.error || 'Failed to resend reset link.')
    } finally {
      setIsResending(false)
    }
  }

  if (!isEmailEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-container-high px-4 py-12">
        <Helmet>
          <title>Admin Reset Password · Cat-Bot</title>
        </Helmet>
        <Alert
          color="warning"
          title="Disabled"
          message="Email services are disabled on this instance."
        />
      </div>
    )
  }

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-container-high px-4 py-12">
        <Helmet>
          <title>Validating... · Cat-Bot</title>
        </Helmet>
        <p className="text-on-surface-variant">Validating secure token...</p>
      </div>
    )
  }

  if (!token || !isTokenValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-container-high px-4 py-12">
        <div className="w-full max-w-sm">
          <Alert
            color={resendSuccess ? 'success' : 'error'}
            title={resendSuccess ? 'Link Sent' : 'Authorization Denied'}
            message={
              resendSuccess
                ? 'A new secure reset link has been sent to your admin email.'
                : 'Your secure token is missing, invalid, or has expired. Please trigger a new request.'
            }
          />
          {resendError && (
            <div className="mt-4">
              <Alert
                variant="tonal"
                color="error"
                title="Resend Failed"
                message={resendError}
                size="sm"
              />
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3">
            {!resendSuccess && emailParam && (
              <Button
                onClick={() => void handleResend()}
                variant="filled"
                color="primary"
                size="md"
                fullWidth
                isLoading={isResending}
              >
                Resend reset link
              </Button>
            )}
            <Button
              as={Link}
              // Append email to URL so the ForgotPassword form populates automatically
              to={`${ROUTES.ADMIN.FORGOT_PASSWORD}${emailParam ? `?email=${encodeURIComponent(emailParam)}` : ''}`}
              variant={!resendSuccess && emailParam ? 'tonal' : 'filled'}
              color="primary"
              size="md"
              fullWidth
            >
              {emailParam ? 'Use a different email' : 'Back to Recovery'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-container-high px-4 py-12">
      <Helmet>
        <title>Admin Reset Password · Cat-Bot</title>
      </Helmet>

      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-primary/10 text-primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div>
            <h1 className="text-headline-sm font-semibold text-on-surface">
              Reset Password
            </h1>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Establish a new credential pair.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-surface shadow-elevation-1 p-6 flex flex-col gap-5">
          {isSubmitted ? (
            <div className="flex flex-col gap-5">
              <Alert
                variant="tonal"
                color="success"
                title="Credential Updated"
                message="Your admin password was successfully secured."
              />
              <Button
                onClick={() => {
                  // WHY: Force a hard page reload to clear any stale session state in React memory
                  window.location.href = ROUTES.ADMIN.ROOT
                }}
                variant="filled"
                color="primary"
                size="md"
                fullWidth
              >
                Access Dashboard
              </Button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex flex-col gap-4"
            >
              <Field.Root invalid={!!errors.password} required>
                <Field.Label>New Password</Field.Label>
                <PasswordInput
                  placeholder="Secure string"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setErrors((prev) => ({ ...prev, password: undefined }))
                  }}
                />
                <Field.ErrorText>{errors.password}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={!!errors.confirmPassword} required>
                <Field.Label>Confirm Password</Field.Label>
                <PasswordInput
                  placeholder="Repeat secure string"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setErrors((prev) => ({
                      ...prev,
                      confirmPassword: undefined,
                    }))
                  }}
                />
                <Field.ErrorText>{errors.confirmPassword}</Field.ErrorText>
              </Field.Root>

              <Button
                type="submit"
                variant="filled"
                color="primary"
                size="md"
                fullWidth
                isLoading={isLoading}
              >
                Confirm reset
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
