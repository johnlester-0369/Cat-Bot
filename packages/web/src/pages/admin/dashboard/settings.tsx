import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useState } from 'react'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Switch from '@/components/ui/forms/Switch'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import DataList from '@/components/ui/data-display/DataList'
import { useTheme } from '@/contexts/ThemeContext'
import { toggleTheme } from '@/utils/theme.util'
import { authAdminClient } from '@/lib/better-auth-admin-client.lib'
import { Plus, Trash2 } from 'lucide-react'
import { adminService } from '@/features/admin/services/admin.service'
import type { SystemAdminDto } from '@/features/admin/services/admin.service'

/**
 * AdminSettingsPage
 *
 * System Admins section now persists to and loads from /api/v1/admin/system-admins
 * so registered IDs survive server restarts and are visible to all admin accounts.
 */
export default function AdminSettingsPage() {
  const { theme, setTheme } = useTheme()

  const { data: session, isPending: sessionLoading } =
    authAdminClient.useSession()

  // ── Profile edit state ─────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState('')
  const [nameInitialized, setNameInitialized] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)

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
    const { error } = await authAdminClient.updateUser({
      name: profileName.trim(),
    })
    if (error) {
      setProfileError(error.message ?? 'Failed to update profile')
    } else {
      setProfileSuccess(true)
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

  const handleChangePassword = async (): Promise<void> => {
    setPasswordError(null)
    setPasswordSuccess(false)
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }
    setPasswordSaving(true)
    const { error } = await authAdminClient.changePassword({
      currentPassword,
      newPassword,
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

  // ── System Admins — real API ───────────────────────────────────────────────
  const [systemAdmins, setSystemAdmins] = useState<SystemAdminDto[]>([])
  const [adminIds, setAdminIds] = useState<string[]>([''])
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminSaving, setAdminSaving] = useState(false)
  const [adminSuccess, setAdminSuccess] = useState(false)

  // Load persisted system admins on mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await adminService.getSystemAdmins()
        setSystemAdmins(result.admins)
        setAdminIds(
          result.admins.length > 0 ? result.admins.map((a) => a.adminId) : [''],
        )
      } catch (err) {
        setAdminError(
          err instanceof Error ? err.message : 'Failed to load system admins',
        )
      } finally {
        setAdminLoading(false)
      }
    }
    void load()
  }, [])

  const handleAdminChange = (index: number, value: string) => {
    setAdminIds((prev) => {
      const ids = [...prev]
      ids[index] = value
      return ids
    })
    setAdminError(null)
    setAdminSuccess(false)
  }

  const handleAddAdminRow = () => {
    setAdminIds((prev) => [...prev, ''])
  }

  const handleRemoveAdminRow = (index: number) => {
    setAdminIds((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    )
  }

  // Compute diff to determine if a save is needed and what to dispatch
  const targetIds = Array.from(
    new Set(adminIds.map((id) => id.trim()).filter((id) => id !== '')),
  )
  const currentIds = systemAdmins.map((a) => a.adminId)
  const isAdminsModified =
    targetIds.length !== currentIds.length ||
    targetIds.some((id) => !currentIds.includes(id)) ||
    currentIds.some((id) => !targetIds.includes(id))

  const handleSaveAdmins = async (): Promise<void> => {
    setAdminSaving(true)
    setAdminError(null)
    setAdminSuccess(false)
    try {
      const toAdd = targetIds.filter((id) => !currentIds.includes(id))
      const toRemove = currentIds.filter((id) => !targetIds.includes(id))

      // Execute operations iteratively to avoid DB lock issues with concurrent operations on the same table
      for (const id of toRemove) await adminService.removeSystemAdmin(id)
      for (const id of toAdd) await adminService.addSystemAdmin(id)

      const result = await adminService.getSystemAdmins()
      setSystemAdmins(result.admins)
      setAdminIds(
        result.admins.length > 0 ? result.admins.map((a) => a.adminId) : [''],
      )

      setAdminSuccess(true)
      setTimeout(() => setAdminSuccess(false), 3000)
    } catch (err) {
      setAdminError(
        err instanceof Error ? err.message : 'Failed to update system admins',
      )
    } finally {
      setAdminSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto pb-12">
      <Helmet>
        <title>Admin Settings · Cat-Bot</title>
      </Helmet>

      <div>
        <h1 className="text-headline-md font-semibold text-on-surface">
          Settings
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Manage your admin profile and interface preferences.
        </p>
      </div>

      {/* ── Appearance ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div className="flex items-center gap-3">
            <div>
              <Card.Title as="h2">Appearance</Card.Title>
              <Card.Description>
                Customize how the Admin dashboard looks for you.
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
          <div>
            <Card.Title as="h2">Admin Profile</Card.Title>
            <Card.Description>Update your display name.</Card.Description>
          </div>
        </Card.Header>
        <div className="flex flex-col gap-5">
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

      {/* ── System Administrators ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">System Administrators</Card.Title>
              <Card.Description>
                The absolute highest authority role in Cat-Bot. System
                Administrators bypass all command role restrictions and ban
                checks.
              </Card.Description>
            </div>
            <Button
              variant="text"
              color="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={handleAddAdminRow}
              disabled={adminSaving || adminLoading}
              aria-label="Add another system admin user ID"
            >
              Add
            </Button>
          </div>
        </Card.Header>
        <div className="flex flex-col gap-3">
          {adminLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-xl bg-surface-container animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {adminIds.map((adminId, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder={`System admin user ID ${index + 1}`}
                      value={adminId}
                      onChange={(e) => handleAdminChange(index, e.target.value)}
                      disabled={adminSaving}
                      aria-label={`System admin user ID ${index + 1}`}
                    />
                  </div>
                  {adminIds.length > 1 && (
                    <Button
                      variant="text"
                      color="error"
                      iconOnly
                      onClick={() => handleRemoveAdminRow(index)}
                      aria-label={`Remove system admin ${index + 1}`}
                      leftIcon={<Trash2 className="h-4 w-4" />}
                      disabled={adminSaving}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {adminError !== null && (
            <Alert variant="tonal" color="error" title={adminError} size="sm" />
          )}
          {adminSuccess && (
            <Alert
              variant="tonal"
              color="success"
              title="System administrators updated successfully."
              size="sm"
            />
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="filled"
              color="primary"
              size="sm"
              onClick={() => void handleSaveAdmins()}
              disabled={adminSaving || !isAdminsModified || adminLoading}
              isLoading={adminSaving}
            >
              Save changes
            </Button>
          </div>
        </div>
      </Card.Root>

      {/* ── Security ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div>
            <Card.Title as="h2">Security</Card.Title>
            <Card.Description>
              Change your password. All other active sessions will be signed
              out.
            </Card.Description>
          </div>
        </Card.Header>
        <div className="flex flex-col gap-4">
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
