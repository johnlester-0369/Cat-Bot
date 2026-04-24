import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import { PLATFORM_LABELS } from '@/constants/platform.constants'
import Table from '@/components/ui/data-display/Table'
import EmptyState from '@/components/ui/data-display/EmptyState'
import Input from '@/components/ui/forms/Input'
import { Bot, Search } from 'lucide-react'
import Badge from '@/components/ui/data-display/Badge'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'
import { useDebounce } from '@/hooks/useDebounce'

/**
 * AdminBotsPage
 *
 * Displays every bot session across all users — data sourced from /api/v1/admin/bots.
 * Replaces the previous mock data to give operators real platform health visibility.
 */
export default function AdminBotsPage() {
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  const [prevSearch, setPrevSearch] = useState(debouncedSearch)
  if (debouncedSearch !== prevSearch) {
    setPrevSearch(debouncedSearch)
    setPage(1)
  }

  const { bots, total, stats, isLoading, error } = useAdminBots(
    page,
    10,
    debouncedSearch,
  )

  const activeBots = stats?.activeBots ?? 0
  const totalBots = stats?.totalBots ?? 0

  return (
    <div className="flex flex-col gap-6">
      <Helmet>
        <title>Admin Bot Sessions · Cat-Bot</title>
      </Helmet>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-headline-md font-semibold text-on-surface">
            Bot Sessions
          </h1>
          <p className="mt-1 text-body-md text-on-surface-variant">
            All registered sessions across platforms.
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
              ? `${total} of ${totalBots} matched`
              : `${activeBots} / ${totalBots} running`}
          </Badge>
        )}
      </div>

      {error !== null && (
        <div className="rounded-xl bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {error}
        </div>
      )}

      {/* Per-platform summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {(
          [
            'discord',
            'telegram',
            'facebook-page',
            'facebook-messenger',
          ] as const
        ).map((platform) => {
          // Stat derived from server's global knowledge
          const platTotal = stats?.platformDist?.[platform] ?? 0
          const platRunning = stats?.platformActiveDist?.[platform] ?? 0
          return (
            <div
              key={platform}
              className="rounded-xl bg-surface border border-outline-variant p-4 shadow-elevation-1 flex flex-col gap-2"
            >
              <span className="text-body-sm font-medium text-on-surface">
                {PLATFORM_LABELS[platform] ?? platform}
              </span>
              <p className="text-headline-sm font-bold text-on-surface">
                {platTotal}
              </p>
              <p className="text-label-sm text-on-surface-variant">
                {platRunning} running
              </p>
            </div>
          )
        })}
      </div>

      <div className="bg-surface p-2 rounded-full">
        <Input
          placeholder="Search bot sessions by nickname, owner, or platform..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
          pill
        />
      </div>

      {/* Only show global empty state if there are truly no bots in the system AND no active search */}
      {!isLoading &&
      bots.length === 0 &&
      error === null &&
      totalBots === 0 &&
      !searchQuery.trim() ? (
        <EmptyState
          icon={Bot}
          title="No bot sessions"
          description="There are currently no registered bot sessions across any platform."
        />
      ) : (
        <>
          <Table.ScrollArea className="bg-surface">
            <Table.Root variant="glass" fullWidth>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Nickname</Table.Head>
                  <Table.Head>Owner</Table.Head>
                  <Table.Head>Platform</Table.Head>
                  <Table.Head>Prefix</Table.Head>
                  <Table.Head>Status</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {isLoading && <Table.Loading colSpan={5} rows={4} />}
                {!isLoading &&
                  bots.map((session) => (
                    <Table.Row key={`${session.userId}:${session.sessionId}`}>
                      <Table.Cell className="font-medium">
                        {session.nickname}
                      </Table.Cell>
                      <Table.Cell>
                        {session.userName || session.userEmail ? (
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-on-surface truncate">
                              {session.userName || 'Unknown User'}
                            </span>
                            <span className="text-label-sm text-on-surface-variant truncate">
                              {session.userEmail}
                            </span>
                          </div>
                        ) : (
                          // Fall back to raw cuid2 when the user row was deleted from the auth DB.
                          <span className="text-on-surface-variant text-label-sm font-mono">
                            {session.userId}
                          </span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-medium">
                          {PLATFORM_LABELS[session.platform] ??
                            session.platform}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="font-mono text-on-surface-variant">
                        {session.prefix}
                      </Table.Cell>
                      <Table.Cell>
                        <Badge
                          variant="tonal"
                          color={session.isRunning ? 'success' : 'default'}
                          size="sm"
                          dot
                          pill
                        >
                          {session.isRunning ? 'Running' : 'Stopped'}
                        </Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                {!isLoading &&
                  bots.length === 0 &&
                  (totalBots > 0 || searchQuery.trim() !== '') && (
                    <Table.Empty
                      colSpan={5}
                      message={
                        searchQuery.trim()
                          ? `No bot sessions match "${searchQuery}"`
                          : 'No bot sessions found.'
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
        </>
      )}
    </div>
  )
}
