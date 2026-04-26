import { Helmet } from '@dr.pogodin/react-helmet'
import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { authUserClient } from '@/lib/better-auth-client.lib'
import { MailCheck } from 'lucide-react'
import apiClient from '@/lib/api-client.lib'

/**
 * Account Verification page — triggered when an unverified user attempts to log in
 * or when someone attempts to sign up with an existing (but unverified) email.
 * Uses better-auth client API to dispatch the verification link.
 */
export default function AccountVerificationPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email') || ''

  const [isSending, setIsSending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 'loading'          — email-status API call in-flight (shown as a spinner)
  // 'not-found'        — address not registered → redirect user to sign up
  // 'already-verified' — address exists and is verified → redirect user to log in
  // 'pending'          — address exists but unverified → show resend flow (normal path)
  const [emailStatus, setEmailStatus] = useState<
    'loading' | 'not-found' | 'already-verified' | 'pending'
  >('loading')

  // Check email existence and verification state immediately on mount.
  // This prevents users from hitting the "send verification" button on an address
  // that doesn't exist (wrong URL) or is already verified (stale link).
  useEffect(() => {
    if (!email) {
      setEmailStatus('not-found')
      return
    }
    let isMounted = true
    const checkEmail = async () => {
      try {
        const { data } = await apiClient.post<{ exists: boolean; verified: boolean }>(
          '/api/v1/validate/email-status',
          { email },
        )
        if (!isMounted) return
        if (!data.exists) {
          setEmailStatus('not-found')
        } else if (data.verified) {
          setEmailStatus('already-verified')
        } else {
          setEmailStatus('pending')
        }
      } catch {
        // Fail open — if the status check errors, fall back to the normal resend flow
        // rather than blocking the user from requesting a new verification link.
        if (isMounted) setEmailStatus('pending')
      }
    }
    void checkEmail()
    return () => {
      isMounted = false
    }
  }, [email])

  const handleSendVerification = async () => {
    if (!email) return
    setIsSending(true)
    setError(null)
    setSuccess(false)

    try {
      const { error: sendError } = await authUserClient.sendVerificationEmail({
        email,
        callbackURL: window.location.origin + ROUTES.LOGIN,
      })

      if (sendError) {
        throw new Error(sendError.message || 'Failed to send verification email.')
      }

      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setIsSending(false)
    }
  }

  // Gracefully handle instances where email services are disabled on the backend.
  if (!isEmailEnabled) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
        </Helmet>
        <Alert
          color="warning"
          title="Disabled"
          message="Email services are disabled on this instance."
        />
      </div>
    )
  }

  if (emailStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
        </Helmet>
        <p className="text-on-surface-variant">Checking account status...</p>
      </div>
    )
  }

  // Email address is not registered — direct user to sign up instead of
  // letting them request a verification link for an account that doesn't exist.
  if (emailStatus === 'not-found') {
    return (
      <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
        </Helmet>
        <div className="w-full max-w-md flex flex-col gap-6">
          <Alert
            color="warning"
            title="Email Not Found"
            message={
              email
                ? `"${email}" is not registered. Please sign up to create an account.`
                : 'This email address is not registered. Please sign up to create an account.'
            }
          />
          <Button
            as={Link}
            to={ROUTES.SIGNUP}
            variant="filled"
            color="primary"
            size="md"
            fullWidth
          >
            Go to Sign Up
          </Button>
        </div>
      </div>
    )
  }

  // Email is already verified — no action needed here; send user to log in.
  if (emailStatus === 'already-verified') {
    return (
      <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
        </Helmet>
        <div className="w-full max-w-md flex flex-col gap-6">
          <Alert
            variant="tonal"
            color="success"
            title="Already Verified"
            message="This email address is already verified. You can log in with your credentials."
          />
          <Button
            as={Link}
            to={ROUTES.LOGIN}
            variant="filled"
            color="primary"
            size="md"
            fullWidth
          >
            Go to Log In
          </Button>
        </div>
      </div>
    )
  }

  // emailStatus === 'pending' — normal resend verification flow
  return (
    <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
      <Helmet>
        <title>Account Verification · Cat-Bot</title>
      </Helmet>

      <div className="w-full max-w-md flex flex-col gap-8">
        <div className="text-center flex flex-col items-center gap-3">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary">
            <MailCheck className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-headline-md font-medium text-on-surface font-brand">
              Verify your email
            </h1>
            <p className="mt-2 text-body-md text-on-surface-variant max-w-sm mx-auto">
              You need to verify your email address to continue. We can send a new verification link to{' '}
              <strong className="text-on-surface">{email || 'your email'}</strong>.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-surface shadow-elevation-1 p-8 flex flex-col gap-6">
          {success ? (
            <div className="flex flex-col gap-6">
              <Alert
                variant="tonal"
                color="success"
                title="Verification email sent!"
                message="Please check your inbox and click the link to verify your account."
              />
              <Button
                as={Link}
                to={ROUTES.LOGIN}
                variant="filled"
                color="primary"
                size="md"
                fullWidth
              >
                Go to log in
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {error && (
                <Alert
                  variant="tonal"
                  color="error"
                  title="Failed to send"
                  message={error}
                />
              )}
              <Button
                onClick={() => void handleSendVerification()}
                variant="filled"
                color="primary"
                size="md"
                fullWidth
                isLoading={isSending}
                disabled={!email}
              >
                Send verification email
              </Button>
            </div>
          )}
        </div>

        {!success && (
          <p className="text-center text-body-md text-on-surface-variant">
            <Button
              as={Link}
              to={ROUTES.LOGIN}
              variant="link"
              color="primary"
              size="md"
            >
              Back to log in
            </Button>
          </p>
        )}
      </div>
    </div>
  )
}