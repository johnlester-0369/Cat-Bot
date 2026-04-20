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
 * Signup page — calls better-auth's signUp.email() directly.
 *
 * On success, redirects to /login so the user authenticates with their fresh credentials.
 * This avoids auto-sign-in complexity (e.g. email verification flows) and keeps the happy
 * path simple until email-verification is configured on the server.
 *
 * Password confirmation is validated client-side to avoid a wasted round-trip for mismatches.
 */
export default function SignupPage() {
  const navigate = useNavigate()

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
      // Clear field error on edit — instant positive feedback for the user.
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
      const result = await authUserClient.signUp.email({
        name: form.name,
        email: form.email,
        password: form.password,
      })
      if (result.error) {
        // better-auth returns structured errors (e.g. EMAIL_ALREADY_EXISTS) rather than throwing
        throw new Error(result.error.message ?? 'Registration failed')
      }
      // Account created — redirect to login so the user signs in with their new credentials.
      navigate(ROUTES.LOGIN)
    } catch (err) {
      setApiError(
        err instanceof Error
          ? err.message
          : 'Sign-up failed. Please try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
      {/* Sets the browser tab title for the sign-up page */}
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
