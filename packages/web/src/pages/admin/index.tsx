import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

interface LoginForm {
  email: string
  password: string
}

interface LoginErrors {
  email?: string
  password?: string
}

/**
 * Admin login page — minimal, restricted-access aesthetic.
 *
 * Intentionally stripped of sign-up links and marketing copy to signal that
 * this is an internal tool, not a user-facing surface. Field validation runs
 * client-side first; API errors surface in a dismissible banner below the form.
 *
 * Auto-redirect to /admin/dashboard is handled upstream by AdminPublicRoute,
 * so this component never needs to check session state itself.
 */
export default function AdminLoginPage() {
  const navigate = useNavigate()
  const { login } = useAdminAuth()

  const [form, setForm] = useState<LoginForm>({ email: '', password: '' })
  const [errors, setErrors] = useState<LoginErrors>({})
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
      // Clear field error immediately on edit — instant positive feedback.
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
      // AdminAuthContext.login() targets /api/admin-auth — sets ba-admin.session_token
      // independently of the user portal cookie; non-admin users are rejected with 403.
      await login(form.email, form.password)
      navigate(ROUTES.ADMIN.DASHBOARD)
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : 'Login failed. Please try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-container-high px-4 py-12">
      <Helmet>
        <title>Admin · Cat-Bot</title>
      </Helmet>

      <div className="w-full max-w-sm flex flex-col gap-6">
        {/* Lock icon + heading — minimal, no marketing copy */}
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-primary/10 text-primary">
            {/* Inline SVG avoids a lucide import just for a single icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
              aria-hidden="true"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div>
            <h1 className="text-headline-sm font-semibold text-on-surface">
              Admin Access
            </h1>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Restricted to authorised administrators only.
            </p>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-2xl bg-surface shadow-elevation-1 p-6 flex flex-col gap-5">
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-4"
          >
            <Field.Root invalid={!!errors.email} required>
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                placeholder="admin@example.com"
                value={form.email}
                onChange={handleChange('email')}
                autoComplete="email"
              />
              <Field.ErrorText>{errors.email}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={!!errors.password} required>
              <Field.Label>Password</Field.Label>
              <PasswordInput
                placeholder="Password"
                value={form.password}
                onChange={handleChange('password')}
                autoComplete="current-password"
              />
              <Field.ErrorText>{errors.password}</Field.ErrorText>
            </Field.Root>

            {/* API-level errors shown below fields — distinct from field validation
                so admins can tell whether the form was incomplete vs credentials were rejected */}
            {apiError && (
              <Alert
                variant="tonal"
                color="error"
                title="Access Denied"
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
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
