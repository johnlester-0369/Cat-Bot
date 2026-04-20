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
import Alert from '@/components/ui/feedback/Alert'
import Badge from '@/components/ui/data-display/Badge'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'
import adminService from '@/features/admin/services/admin.service'

interface ManagedUser {
  id: string
  name: string
  email: string
  role: string | null
  // Aligned with better-auth UserWithRole.createdAt (Date) to fix TS2352
  createdAt: Date
  banned: boolean | null
}

/**
 * AdminUsersPage
 *
 * Standalone page for user management. Separating this ensures the overview
 * page doesn't unnecessarily pull the entire user payload when not needed.
 */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // Fetch all bot sessions to derive real per-user counts — the same endpoint already
  // consumed by the admin overview, so this shares the LRU cache and adds no DB round-trip.
  const { bots } = useAdminBots()

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

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const result = await authAdminClient.admin.listUsers({
          query: { limit: 100 },
        })
        if (result.error) {
          setError(result.error.message ?? 'Failed to load users')
        } else {
          setUsers((result.data?.users ?? []) as ManagedUser[])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users')
      } finally {
        setIsLoading(false)
      }
    }
    void fetchUsers()
  }, [])

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
        setUsers((prev) =>
          prev.map((u) => (u.id === banTarget.id ? { ...u, banned: true } : u)),
        )
        setBanTarget(null)
        setBanReason('')
        // Fire-and-forget: stop all running bot sessions for the banned user.
        // The dialog closes immediately; session teardown is async so the operator
        // is never blocked by network latency or a large bot-session count.
        adminService.stopUserSessions(banTarget.id).catch((err) => {
          console.error('[AdminUsersPage] Failed to stop sessions for banned user', err)
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
        setUsers((prev) =>
          prev.map((u) =>
            u.id === unbanTarget.id ? { ...u, banned: false } : u,
          ),
        )
        setUnbanTarget(null)
        // Fire-and-forget: restart all bot sessions for the unbanned user.
        // Same rationale as the ban path — the UI resolves immediately.
        adminService.startUserSessions(unbanTarget.id).catch((err) => {
          console.error('[AdminUsersPage] Failed to start sessions for unbanned user', err)
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

  // Client-side filtering to ensure instant UI response and avoid unnecessary network requests
  const filteredUsers =
    searchQuery.trim() === ''
      ? users
      : users.filter(
          (u) =>
            u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (u.role ?? 'user')
              .toLowerCase()
              .includes(searchQuery.toLowerCase()),
        )

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
            {searchQuery.trim()
              ? `${filteredUsers.length} of ${users.length} matched`
              : `${users.length} total`}
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

      {/* Columns: Name, Email, Role, Bot Sessions, Joined, Actions (6 total).
          Status was removed — the schema has no status field; banned is
          surfaced via the action cell instead of a dedicated column. */}
      <Table.ScrollArea className="bg-surface">
        <Table.Root variant="glass" fullWidth>
          <Table.Header>
            <Table.Row>
              <Table.Head>Name</Table.Head>
              <Table.Head>Email</Table.Head>
              <Table.Head>Role</Table.Head>
              <Table.Head>Bot Sessions</Table.Head>
              <Table.Head>Joined</Table.Head>
              <Table.Head align="right">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {isLoading && <Table.Loading colSpan={6} rows={4} />}
            {!isLoading &&
              filteredUsers.map((u) => (
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
                  {(() => {
                    const userBots = bots.filter((b) => b.userId === u.id);
                    const total = userBots.length;
                    // Count only the running sessions for this specific user, not the global total
                    const active = userBots.filter((b) => b.isRunning).length;
                    if (total === 0) return <span className="text-on-surface-variant/50">—</span>;
                    return (
                      <Badge variant="tonal" color="info" size="sm" pill>
                        {active}/{total} session{total !== 1 ? 's' : ''}
                      </Badge>
                    );
                  })()}
                </Table.Cell>
                <Table.Cell className="text-on-surface-variant">
                  {new Date(u.createdAt).toLocaleDateString()}
                </Table.Cell>
                  <Table.Cell align="right">
                    {/* Admins cannot be banned — would lock out the control plane.
                        Already-banned accounts show a static label rather than a
                        redundant action button. */}
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
                      <div className="flex items-center justify-end gap-3">
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
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
            ))}
            {!isLoading && filteredUsers.length === 0 && (
              <Table.Empty
                colSpan={6}
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
                  {banTarget?.name}
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
                variant="filled"
                color="error"
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
                  {unbanTarget?.name}
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
    </div>
  )
}
