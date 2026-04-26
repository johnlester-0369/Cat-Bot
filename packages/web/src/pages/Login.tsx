import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'

interface LoginForm {
  email: string
  password: string
}

interface LoginErrors {
  email?: string
  password?: string
}

/**
 * Login page — wired to better-auth via UserAuthContext.login().
 *
 * Field validation runs client-side first to avoid a wasted round-trip for empty/malformed
 * inputs. API-level errors (wrong credentials, locked account, etc.) are surfaced in a
 * separate error banner below the fields so users know which layer rejected the request.
 */
export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useUserAuth()

  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'

  const[form, setForm] = useState<LoginForm>({ email: '', password: '' })
  const[errors, setErrors] = useState<LoginErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const validate = (): LoginErrors => {
    const e: LoginErrors = {}
    if (!form.email) e.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email))
      e.email = 'Enter a valid email address.'
    if (!form.password) e.password = 'Password is required.'
    return e
  }

  const handleChange =
    (field: keyof LoginForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
      // Clear field-level error on edit — gives users instant positive feedback.
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
      // UserAuthContext.login() calls better-auth's signIn.email endpoint and refreshes
      // the session — throws with a descriptive message on wrong credentials or server error.
      await login(form.email, form.password)
      navigate(ROUTES.DASHBOARD.ROOT)
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : 'Login failed. Please try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-6 py-12">
      {/* Sets the browser tab title for the login page */}
      <Helmet>
        <title>Log In · Cat-Bot</title>
      </Helmet>
      <div className="w-full max-w-md flex flex-col gap-8">
        {/* Header */}
        <div className="text-center flex flex-col gap-2">
          <h1 className="text-headline-md font-medium text-on-surface font-brand">
            Welcome back to Cat-Bot
          </h1>
          <p className="text-body-md text-on-surface-variant max-w-sm mx-auto">
            Sign in to manage your bots across Discord, Telegram, and Facebook.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl bg-surface shadow-elevation-1 p-8 flex flex-col gap-6">
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-5"
          >
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
              <div className="flex items-center justify-between">
                <Field.Label className="mb-0">Password</Field.Label>
                {isEmailEnabled && (
                  <Link to={ROUTES.FORGOT_PASSWORD} className="text-label-sm text-primary hover:underline">
                    Forgot password?
                  </Link>
                )}
              </div>
              <PasswordInput
                placeholder="Your password"
                value={form.password}
                onChange={handleChange('password')}
                autoComplete="current-password"
              />
              <Field.ErrorText>{errors.password}</Field.ErrorText>
            </Field.Root>

            {/* API-level error — shown separately from field validation so users can
                distinguish "field is empty" from "credentials are wrong" */}
            {apiError && (
              <Alert
                variant="tonal"
                color="error"
                title="Login Failed"
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
              Log in
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-body-md text-on-surface-variant">
          Don&apos;t have an account?{' '}
          <Button
            as={Link}
            to={ROUTES.SIGNUP}
            variant="link"
            color="primary"
            size="md"
          >
            Sign up
          </Button>
        </p>
      </div>
    </div>
  )
}
