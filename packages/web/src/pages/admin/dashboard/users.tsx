import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { authAdminClient } from '@/lib/better-auth-admin-client.lib'
import Table from '@/components/ui/data-display/Table'
import Dialog from '@/components/ui/overlay/Dialog'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Textarea from '@/components/ui/forms/Textarea'
import Select from '@/components/ui/forms/Select'
import Alert from '@/components/ui/feedback/Alert'
import Badge from '@/components/ui/data-display/Badge'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'
import { useAdminUsers } from '@/features/admin/hooks/useAdminUsers'
import { useDebounce } from '@/hooks/useDebounce'
import adminService from '@/features/admin/services/admin.service'

interface ManagedUser {
  id: string
  name: string
  email: string
  role: string | null
  createdAt: string
  banned: boolean
  emailVerified: boolean
}

/**
 * AdminUsersPage
 *
 * Standalone page for user management. Separating this ensures the overview
 * page doesn't unnecessarily pull the entire user payload when not needed.
 */
export default function AdminUsersPage() {
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const { users, total, isLoading, error, refetch } = useAdminUsers(
    page,
    10,
    debouncedSearch,
  )

  // We still load ALL bots locally without pagination to safely derive user-bot relation counts on the client
  const { bots } = useAdminBots(1, 10000, '')

  // Tracks which user the admin is about to ban — null means the dialog is closed.
  // Keeping this as a full ManagedUser object (not just id) lets the dialog render
  // the target's name without a secondary lookup.
  const [banTarget, setBanTarget] = useState<ManagedUser | null>(null)
  const [banReason, setBanReason] = useState('')
  const [isBanning, setIsBanning] = useState(false)
  const [banError, setBanError] = useState<string | null>(null)

  // Tracks the user currently selected for unbanning
  const [unbanTarget, setUnbanTarget] = useState<ManagedUser | null>(null)
  const [isUnbanning, setIsUnbanning] = useState(false)
  const [unbanError, setUnbanError] = useState<string | null>(null)

  // ── Edit User State ────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    role: 'user',
  })
  const [isEditing, setIsEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const openEditDialog = (user: ManagedUser) => {
    setEditTarget(user)
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role ?? 'user',
    })
    setEditError(null)
  }

  const closeEditDialog = () => {
    if (isEditing) return
    setEditTarget(null)
    setEditError(null)
  }

  const handleEditUser = async () => {
    if (!editTarget) return
    setIsEditing(true)
    setEditError(null)
    try {
      await adminService.updateUser(editTarget.id, editForm)
      void refetch()
      closeEditDialog()
    } catch (err) {
      // WHY: Extract explicit { error: "..." } from Axios/fetch responses to surface backend validation errors (e.g., email collisions) instead of generic 400 messages
      const e = err as { response?: { data?: { error?: string } } }
      setEditError(e.response?.data?.error || (err instanceof Error ? err.message : 'Failed to update user'))
    } finally {
      setIsEditing(false)
    }
  }

  // ── Verify State ───────────────────────────────────────────────────────────
  const [verifyTarget, setVerifyTarget] = useState<ManagedUser | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const openVerifyDialog = (user: ManagedUser) => {
    setVerifyTarget(user)
    setVerifyError(null)
  }

  const closeVerifyDialog = () => {
    if (isVerifying) return
    setVerifyTarget(null)
    setVerifyError(null)
  }

  // Refactored to operate on the active dialog target rather than inline execution
  const handleVerifyUser = async () => {
    if (!verifyTarget) return
    setIsVerifying(true)
    setVerifyError(null)
    try {
      await adminService.verifyUser(verifyTarget.id)
      void refetch()
      closeVerifyDialog()
    } catch (err) {
      // WHY: Ensure server-side verification errors are surfaced correctly to the UI
      const e = err as { response?: { data?: { error?: string } } }
      setVerifyError(e.response?.data?.error || (err instanceof Error ? err.message : 'Failed to verify user'))
    } finally {
      setIsVerifying(false)
    }
  }

  // Calls better-auth admin.banUser then optimistically flips the local row's
  // banned flag so the operator sees immediate feedback without a full re-fetch.
  // banReason is optional per the schema (String? on the user model).
  const handleBanUser = async (): Promise<void> => {
    if (!banTarget) return
    setIsBanning(true)
    setBanError(null)
    try {
      const result = await authAdminClient.admin.banUser({
        userId: banTarget.id,
        ...(banReason.trim() ? { banReason: banReason.trim() } : {}),
      })
      if (result.error) {
        setBanError(result.error.message ?? 'Failed to ban user')
      } else {
        setBanTarget(null)
        setBanReason('')
        void refetch()
        // Fire-and-forget: stop all running bot sessions for the banned user.
        // The dialog closes immediately; session teardown is async so the operator
        // is never blocked by network latency or a large bot-session count.
        adminService.stopUserSessions(banTarget.id).catch((err) => {
          console.error(
            '[AdminUsersPage] Failed to stop sessions for banned user',
            err,
          )
        })
      }
    } catch (err) {
      setBanError(err instanceof Error ? err.message : 'Failed to ban user')
    } finally {
      setIsBanning(false)
    }
  }

  const openBanDialog = (user: ManagedUser) => {
    setBanTarget(user)
    setBanReason('')
    setBanError(null)
  }

  // Guard against closing mid-request — losing the isBanning state would leave
  // the UI stuck showing a loading spinner with no way to dismiss it.
  const closeBanDialog = () => {
    if (isBanning) return
    setBanTarget(null)
    setBanReason('')
    setBanError(null)
  }

  // Calls better-auth admin.unbanUser to restore a user's access, followed by an optimistic table update
  const handleUnbanUser = async (): Promise<void> => {
    if (!unbanTarget) return
    setIsUnbanning(true)
    setUnbanError(null)
    try {
      const result = await authAdminClient.admin.unbanUser({
        userId: unbanTarget.id,
      })
      if (result.error) {
        setUnbanError(result.error.message ?? 'Failed to unban user')
      } else {
        setUnbanTarget(null)
        void refetch()
        // Fire-and-forget: restart all bot sessions for the unbanned user.
        // Same rationale as the ban path — the UI resolves immediately.
        adminService.startUserSessions(unbanTarget.id).catch((err) => {
          console.error(
            '[AdminUsersPage] Failed to start sessions for unbanned user',
            err,
          )
        })
      }
    } catch (err) {
      setUnbanError(err instanceof Error ? err.message : 'Failed to unban user')
    } finally {
      setIsUnbanning(false)
    }
  }

  const openUnbanDialog = (user: ManagedUser) => {
    setUnbanTarget(user)
    setUnbanError(null)
  }

  const closeUnbanDialog = () => {
    if (isUnbanning) return
    setUnbanTarget(null)
    setUnbanError(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <Helmet>
        <title>Admin Users · Cat-Bot</title>
      </Helmet>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-headline-md font-semibold text-on-surface">
            Users
          </h1>
          <p className="mt-1 text-body-md text-on-surface-variant">
            All registered accounts — real data from the auth database.
          </p>
        </div>
        {!isLoading && (
          <Badge
            variant="tonal"
            color="primary"
            size="md"
            pill
            className="shrink-0"
          >
            {searchQuery.trim() ? `${total} matched` : `${total} total`}
          </Badge>
        )}
      </div>

      {error !== null && (
        <div className="rounded-xl bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {error}
        </div>
      )}

      <div className="bg-surface p-2 rounded-full">
        <Input
          placeholder="Search users by name, email, or role..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
          pill
        />
      </div>

      <Table.ScrollArea className="bg-surface">
        <Table.Root variant="glass" fullWidth>
          <Table.Header>
            <Table.Row>
              <Table.Head>Name</Table.Head>
              <Table.Head>Email</Table.Head>
              <Table.Head>Role</Table.Head>
              <Table.Head>Verified</Table.Head>
              <Table.Head>Bot Sessions</Table.Head>
              <Table.Head>Joined</Table.Head>
              <Table.Head align="right">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {isLoading && <Table.Loading colSpan={7} rows={4} />}
            {!isLoading &&
              users.map((u) => (
                <Table.Row key={u.id}>
                  <Table.Cell className="font-medium">{u.name}</Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    {u.email}
                  </Table.Cell>
                  <Table.Cell>
                    {/* Role badge delegates color logic to Badge instead of ternary class strings */}
                    <Badge
                      variant="tonal"
                      color={u.role === 'admin' ? 'primary' : 'default'}
                      size="sm"
                      pill
                    >
                      {u.role ?? 'user'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      variant="tonal"
                      color={u.emailVerified ? 'success' : 'warning'}
                      size="sm"
                      pill
                    >
                      {u.emailVerified ? 'Verified' : 'Pending'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {(() => {
                      const userBots = bots.filter((b) => b.userId === u.id)
                      const total = userBots.length
                      // Count only the running sessions for this specific user, not the global total
                      const active = userBots.filter((b) => b.isRunning).length
                      if (total === 0)
                        return (
                          <span className="text-on-surface-variant/50">—</span>
                        )
                      return (
                        <Badge variant="tonal" color="info" size="sm" pill>
                          {active}/{total} session{total !== 1 ? 's' : ''}
                        </Badge>
                      )
                    })()}
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </Table.Cell>
                  <Table.Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      {u.role !== 'admin' && !u.banned && (
                        <Button
                          variant="tonal"
                          color="error"
                          size="xs"
                          onClick={() => openBanDialog(u)}
                        >
                          Ban
                        </Button>
                      )}
                      {u.banned === true && (
                        <>
                          <Badge variant="tonal" color="error" size="sm" pill>
                            Banned
                          </Badge>
                          <Button
                            variant="tonal"
                            color="success"
                            size="xs"
                            onClick={() => openUnbanDialog(u)}
                          >
                            Unban
                          </Button>
                        </>
                      )}
                      <Button
                        variant="tonal"
                        color="primary"
                        size="xs"
                        onClick={() => openEditDialog(u)}
                      >
                        Edit
                      </Button>
                      {!u.emailVerified && (
                        <Button
                          variant="tonal"
                          color="info"
                          size="xs"
                          onClick={() => openVerifyDialog(u)}
                        >
                          Verify
                        </Button>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            {!isLoading && users.length === 0 && (
              <Table.Empty
                colSpan={7}
                message={
                  searchQuery.trim()
                    ? `No users match "${searchQuery}"`
                    : 'No users found.'
                }
              />
            )}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
      {total > 0 && (
        <Table.Pagination
          currentPage={page}
          totalItems={total}
          itemsPerPage={10}
          onPageChange={setPage}
        />
      )}

      {/* Ban dialog — controlled via banTarget state so no Trigger is needed.
          closeOnEsc / closeOnOverlayClick are disabled while the request is in
          flight to prevent abandoning a partially committed ban operation. */}
      <Dialog.Root
        open={banTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeBanDialog()
        }}
        closeOnEsc={!isBanning}
        closeOnOverlayClick={!isBanning}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Ban User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Banning{' '}
                <span className="font-semibold text-on-surface">
                  {banTarget?.name} ({banTarget?.email})
                </span>{' '}
                will prevent them from signing in. The reason is stored in the
                database and visible to other admins.
              </p>
              <Field.Root>
                <Field.Label>
                  Reason{' '}
                  <span className="text-on-surface-variant font-normal">
                    (optional)
                  </span>
                </Field.Label>
                <Textarea
                  value={banReason}
                  onChange={(e) => {
                    setBanReason(e.target.value)
                    setBanError(null)
                  }}
                  placeholder="Describe why this account is being banned…"
                  disabled={isBanning}
                  rows={3}
                />
              </Field.Root>
              {banError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={banError}
                    size="sm"
                  />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isBanning}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                className="!bg-[rgb(var(--light-color-error))] !text-[rgb(var(--light-color-surface))]"
                size="sm"
                onClick={() => {
                  void handleBanUser()
                }}
                isLoading={isBanning}
                disabled={isBanning}
              >
                Ban User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Unban dialog — controlled via unbanTarget state.
          closeOnEsc / closeOnOverlayClick are disabled while the request is in flight. */}
      <Dialog.Root
        open={unbanTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeUnbanDialog()
        }}
        closeOnEsc={!isUnbanning}
        closeOnOverlayClick={!isUnbanning}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Unban User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Are you sure you want to unban{' '}
                <span className="font-semibold text-on-surface">
                  {unbanTarget?.name} ({unbanTarget?.email})
                </span>
                ? This will restore their access to the platform.
              </p>
              {unbanError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={unbanError}
                    size="sm"
                  />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isUnbanning}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="success"
                size="sm"
                onClick={() => {
                  void handleUnbanUser()
                }}
                isLoading={isUnbanning}
                disabled={isUnbanning}
              >
                Unban User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Edit User Dialog */}
      <Dialog.Root
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeEditDialog()
        }}
        closeOnEsc={!isEditing}
        closeOnOverlayClick={!isEditing}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Edit User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body className="flex flex-col gap-4">
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  disabled={isEditing}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Email</Field.Label>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  disabled={isEditing}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Role</Field.Label>
                {/* Utilizing the unified design system Select component */}
                <Select
                  options={[
                    { value: 'user', label: 'User' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                  value={editForm.role}
                  onChange={(value) =>
                    setEditForm((prev) => ({ ...prev, role: value }))
                  }
                  disabled={isEditing}
                />
              </Field.Root>
              {editError !== null && (
                <div className="mt-2">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={editError}
                    size="sm"
                  />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isEditing}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="primary"
                size="sm"
                onClick={() => void handleEditUser()}
                isLoading={isEditing}
                disabled={isEditing}
              >
                Save Changes
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Verify User Dialog */}
      <Dialog.Root
        open={verifyTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeVerifyDialog()
        }}
        closeOnEsc={!isVerifying}
        closeOnOverlayClick={!isVerifying}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Verify User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Are you sure you want to manually verify{' '}
                <span className="font-semibold text-on-surface">
                  {verifyTarget?.name} ({verifyTarget?.email})
                </span>
                ? This will bypass the email verification process.
              </p>
              {verifyError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={verifyError}
                    size="sm"
                  />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isVerifying}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="info"
                size="sm"
                onClick={() => void handleVerifyUser()}
                isLoading={isVerifying}
                disabled={isVerifying}
              >
                Verify User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
