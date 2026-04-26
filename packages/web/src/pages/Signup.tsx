import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import { ROUTES } from '@/constants/routes.constants'
import Alert from '@/components/ui/feedback/Alert'
import { authUserClient } from '@/lib/better-auth-client.lib'
import { useUserAuth } from '@/contexts/UserAuthContext'
import apiClient from '@/lib/api-client.lib'

interface SignupForm {
  name: string
  email: string
  password: string
  confirmPassword: string
}

interface SignupErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
}

/**
 * Signup page — all email-collision scenarios handled via a two-step check:
 *
 *  1. Pre-flight  /api/v1/validate/email-status → { exists, verified }
 *  2. If exists   → attempt login() to probe the password; branch on the thrown error:
 *
 *   exists + verified   + correct pw  → session created → dashboard
 *   exists + verified   + wrong pw    → alert "email already registered"
 *   exists + unverified + correct pw  → 403 "verif" message → account verification page
 *   exists + unverified + wrong pw    → alert "email already registered"
 *   exists + banned     + any pw      → FORBIDDEN fires before pw check → surfaces ban reason
 *   not exists                        → signUp.email → verification (email on) or login
 *
 * better-auth evaluates: banned-hook → password → verification-gate — in that order.
 * This ordering is what makes the three-way branch possible from a single login() attempt.
 */
export default function SignupPage() {
  const navigate = useNavigate()
  const { login } = useUserAuth()
  const [form, setForm] = useState<SignupForm>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<SignupErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const validate = (): SignupErrors => {
    const e: SignupErrors = {}
    if (!form.name.trim()) e.name = 'Name is required.'
    if (!form.email) e.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email))
      e.email = 'Enter a valid email address.'
    if (!form.password) e.password = 'Password is required.'
    else if (form.password.length < 8)
      e.password = 'Password must be at least 8 characters.'
    if (!form.confirmPassword)
      e.confirmPassword = 'Please confirm your password.'
    else if (form.password !== form.confirmPassword)
      e.confirmPassword = 'Passwords do not match.'
    return e
  }

  const handleChange =
    (field: keyof SignupForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
    }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }
    setApiError(null)
    setIsLoading(true)
    try {
      // Pre-flight: resolve existence + verification state before any sign-in attempt.
      // This avoids a blind signUp call that better-auth silently swallows when
      // requireEmailVerification is active and the email already exists.
      const { data: status } = await apiClient.post<{
        exists: boolean
        verified: boolean
      }>('/api/v1/validate/email-status', { email: form.email })

      if (status.exists) {
        // Probe the supplied password via a real sign-in attempt.
        // better-auth evaluates in this order: banned-hook → password → verification-gate.
        // That ordering gives us three distinct outcomes from a single login() call:
        //   • success            → correct pw + verified
        //   • throws "verif"     → correct pw + unverified (403 from verification gate)
        //   • throws "banned"    → account is banned (FORBIDDEN from before-hook)
        //   • throws anything else → wrong password (401/422 from credential check)
        try {
          await login(form.email, form.password)
          // Credentials matched and email is verified — go straight to the dashboard.
          navigate(ROUTES.DASHBOARD.ROOT)
          return
        } catch (signInErr) {
          const signInMsg =
            signInErr instanceof Error ? signInErr.message.toLowerCase() : ''

          if (signInMsg.includes('verif')) {
            // Password was correct but the email has not been verified yet.
            if (import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true') {
              navigate(
                `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(form.email)}`,
              )
            } else {
              setApiError(
                signInErr instanceof Error
                  ? signInErr.message
                  : 'Please verify your email.',
              )
            }
            return
          }

          if (signInMsg.includes('banned')) {
            // The server's before-hook fires before the password check, so a banned account
            // always surfaces the ban reason here regardless of whether the password was correct.
            // Surface the real message so the user knows why they cannot proceed.
            setApiError(
              signInErr instanceof Error ? signInErr.message : 'Your account has been banned.',
            )
            return
          }

          // Password did not match — the email belongs to a different account.
          setApiError(
            'This email is already registered. Please use a different email or log in.',
          )
          return
        }
      }

      // Email does not exist at all — create a new account.
      const result = await authUserClient.signUp.email({
        name: form.name,
        email: form.email,
        password: form.password,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Registration failed')
      }

      if (import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true') {
        navigate(
          `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(form.email)}`,
        )
      } else {
        navigate(ROUTES.LOGIN)
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sign-up failed. Please try again.'
      setApiError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
      <Helmet>
        <title>Sign Up · Cat-Bot</title>
      </Helmet>
      <div className="w-full max-w-md flex flex-col gap-8">
        {/* Header */}
        <div className="text-center flex flex-col gap-2">
          <h1 className="text-headline-md font-medium text-on-surface font-brand">
            Start building with Cat-Bot
          </h1>
          <p className="text-body-md text-on-surface-variant max-w-sm mx-auto">
            Deploy bots across Discord, Telegram, and Facebook in minutes — all
            from one dashboard.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl bg-surface shadow-elevation-1 p-8 flex flex-col gap-6">
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-5"
          >
            {/* Full name */}
            <Field.Root invalid={!!errors.name} required>
              <Field.Label>Full name</Field.Label>
              <Input
                type="text"
                placeholder="Jane Smith"
                value={form.name}
                onChange={handleChange('name')}
                autoComplete="name"
              />
              <Field.ErrorText>{errors.name}</Field.ErrorText>
            </Field.Root>

            {/* Email */}
            <Field.Root invalid={!!errors.email} required>
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handleChange('email')}
                autoComplete="email"
              />
              <Field.ErrorText>{errors.email}</Field.ErrorText>
            </Field.Root>

            {/* Password */}
            <Field.Root invalid={!!errors.password} required>
              <Field.Label>Password</Field.Label>
              <PasswordInput
                placeholder="At least 8 characters"
                value={form.password}
                onChange={handleChange('password')}
                autoComplete="new-password"
              />
              <Field.ErrorText>{errors.password}</Field.ErrorText>
            </Field.Root>

            {/* Confirm password */}
            <Field.Root invalid={!!errors.confirmPassword} required>
              <Field.Label>Confirm password</Field.Label>
              <PasswordInput
                placeholder="Repeat your password"
                value={form.confirmPassword}
                onChange={handleChange('confirmPassword')}
                autoComplete="new-password"
              />
              <Field.ErrorText>{errors.confirmPassword}</Field.ErrorText>
            </Field.Root>

            {/* API-level error — surfaced separately from field validation */}
            {apiError && (
              <Alert
                variant="tonal"
                color="error"
                title="Sign-up Failed"
                message={apiError}
              />
            )}

            <Button
              type="submit"
              variant="filled"
              color="primary"
              size="md"
              fullWidth
              isLoading={isLoading}
            >
              Create account
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-body-md text-on-surface-variant">
          Already have an account?{' '}
          <Button
            as={Link}
            to={ROUTES.LOGIN}
            variant="link"
            color="primary"
            size="md"
          >
            Log in
          </Button>
        </p>
      </div>
    </div>
  )
}