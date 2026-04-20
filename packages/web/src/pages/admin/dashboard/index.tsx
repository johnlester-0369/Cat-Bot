import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useEffect, useState } from 'react'
import { Users, Bot, ShieldBan, AlertCircle } from 'lucide-react'
import { authAdminClient } from '@/lib/better-auth-admin-client.lib'
import { PLATFORM_LABELS } from '@/constants/platform.constants'
import Badge from '@/components/ui/data-display/Badge'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ManagedUser {
  id: string
  name: string
  email: string
  role: string | null
  // Aligned with better-auth UserWithRole.createdAt (Date) to fix TS2352
  createdAt: Date
  banned: boolean | null
}

// ── Shared subcomponents ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  colorClass,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  colorClass: string
}) {
  return (
    <div className="rounded-2xl bg-surface border border-outline-variant p-5 flex flex-col gap-3 shadow-elevation-1">
      <div
        className={`h-10 w-10 rounded-xl flex items-center justify-center ${colorClass}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-headline-sm font-bold text-on-surface">{value}</p>
        <p className="text-body-sm text-on-surface-variant">{label}</p>
      </div>
    </div>
  )
}

// ── Main page component ───────────────────────────────────────────────────────

/**
 * AdminDashboardPage (Overview)
 *
 * Bot stats now sourced from the real /api/v1/admin/bots endpoint rather than
 * inline mock data so the platform health numbers reflect live state.
 */
export default function AdminDashboardPage() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [isUsersLoading, setIsUsersLoading] = useState(true)
  const { bots, isLoading: isBotsLoading } = useAdminBots()

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const result = await authAdminClient.admin.listUsers({
          query: { limit: 10 },
        })
        if (!result.error) {
          setUsers((result.data?.users ?? []) as ManagedUser[])
        }
      } catch (err) {
        console.error('Failed to load recent users', err)
      } finally {
        setIsUsersLoading(false)
      }
    }
    void fetchUsers()
  }, [])

  const totalUsers = users.length
  const adminCount = users.filter((u) => u.role === 'admin').length
  const bannedCount = users.filter((u) => u.banned).length
  const activeBots = bots.filter((s) => s.isRunning).length
  const totalBots = bots.length

  const platformDist = bots.reduce<Record<string, number>>((acc, s) => {
    acc[s.platform] = (acc[s.platform] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      <Helmet>
        <title>Admin Overview · Cat-Bot</title>
      </Helmet>
      <div>
        <h1 className="text-headline-md font-semibold text-on-surface">
          Overview
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Platform health and activity at a glance.
        </p>
      </div>

      {/* ── Stat grid ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Registered Users"
          value={isUsersLoading ? '…' : String(totalUsers)}
          icon={Users}
          colorClass="bg-primary-container text-on-primary-container"
        />
        <StatCard
          label="Active Bots"
          value={isBotsLoading ? '…' : `${activeBots} / ${totalBots}`}
          icon={Bot}
          colorClass="bg-tertiary-container text-on-tertiary-container"
        />
        <StatCard
          label="Admin Accounts"
          value={isUsersLoading ? '…' : String(adminCount)}
          icon={ShieldBan}
          colorClass="bg-secondary-container text-on-secondary-container"
        />
        <StatCard
          label="Banned Accounts"
          value={isUsersLoading ? '…' : String(bannedCount)}
          icon={AlertCircle}
          colorClass="bg-error-container text-on-error-container"
        />
      </div>

      {/* ── Detail cards ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform distribution — real data from useAdminBots */}
        <div className="rounded-2xl bg-surface border border-outline-variant p-5 shadow-elevation-1">
          <h2 className="text-title-md font-semibold text-on-surface mb-4">
            Bot Platform Distribution
          </h2>
          {isBotsLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-xl bg-surface-container animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {Object.entries(platformDist).map(([platform, count]) => {
                const running = bots.filter(
                  (s) => s.platform === platform && s.isRunning,
                ).length
                return (
                  <div
                    key={platform}
                    className="flex items-center justify-between py-3 border-b border-outline-variant/50 last:border-0"
                  >
                    <span className="text-body-sm font-medium text-on-surface">
                      {PLATFORM_LABELS[platform] ?? platform}
                    </span>
                    <div className="text-right">
                      <p className="text-body-sm font-semibold text-on-surface">
                        {count} session{count !== 1 ? 's' : ''}
                      </p>
                      <p className="text-label-sm text-on-surface-variant">
                        {running} running
                      </p>
                    </div>
                  </div>
                )
              })}
              {Object.keys(platformDist).length === 0 && (
                <p className="text-body-sm text-on-surface-variant text-center py-6">
                  No bot sessions registered yet.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Recent registrations */}
        <div className="rounded-2xl bg-surface border border-outline-variant p-5 shadow-elevation-1">
          <h2 className="text-title-md font-semibold text-on-surface mb-4">
            Recent Registrations
          </h2>
          {isUsersLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-xl bg-surface-container animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {users.slice(0, 6).map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between py-2.5 border-b border-outline-variant/50 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium text-on-surface truncate">
                      {u.name}
                    </p>
                    <p className="text-label-sm text-on-surface-variant truncate">
                      {u.email}
                    </p>
                  </div>
                  <Badge
                    variant="tonal"
                    color={u.role === 'admin' ? 'primary' : 'default'}
                    size="sm"
                    pill
                    className="ml-3 shrink-0"
                  >
                    {u.role ?? 'user'}
                  </Badge>
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-body-sm text-on-surface-variant text-center py-6">
                  No users registered yet.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
