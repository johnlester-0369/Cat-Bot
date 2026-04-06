import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Plus, ChevronRight } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import Card from '@/components/ui/data-display/Card'
import Alert from '@/components/ui/feedback/Alert'
import Badge from '@/components/ui/data-display/Badge'
import Skeleton from '@/components/ui/feedback/Skeleton'
import EmptyState from '@/components/ui/data-display/EmptyState'
import Status from '@/components/ui/data-display/Status'
import { ROUTES } from '@/constants/routes.constants'
import { useBotList } from '@/hooks/useBotList'
import { useBotStatus } from '@/hooks/useBotStatus'
import type { GetBotListItemDto } from '@/dtos/bot.dto'
import { getPlatformLabel } from '@/utils/bot.util'

// ============================================================================
// Helpers
// ============================================================================

// ============================================================================
// Platform Brand Icons
// ============================================================================

// Brand SVGs from Simple Icons (simpleicons.org). aria-hidden because the
// platform name is rendered as adjacent text — these are purely decorative.
// fill="currentColor" inherits text-on-primary-container from the icon slot.

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function FacebookPageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  )
}

function FacebookMessengerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.24 0 0 4.952 0 11.64c0 3.499 1.434 6.521 3.769 8.61a.96.96 0 0 1 .323.683l.065 2.135a.96.96 0 0 0 1.347.85l2.381-1.053a.96.96 0 0 1 .641-.046A13 13 0 0 0 12 23.28c6.76 0 12-4.952 12-11.64S18.76 0 12 0m6.806 7.44c.522-.03.971.567.63 1.094l-4.178 6.457a.707.707 0 0 1-.977.208l-3.87-2.504a.44.44 0 0 0-.49.007l-4.363 3.01c-.637.438-1.415-.317-.995-.966l4.179-6.457a.706.706 0 0 1 .977-.21l3.87 2.505c.15.097.344.094.491-.007l4.362-3.008a.7.7 0 0 1 .364-.13" />
    </svg>
  )
}

// Falls back to Bot (lucide) for unknown platforms to stay forward-compatible
// when new platforms are added on the backend before the frontend is updated.
function getPlatformIcon(platform: string) {
  const iconClass = 'h-5 w-5'
  switch (platform) {
    case 'discord':
      return <DiscordIcon className={iconClass} />
    case 'telegram':
      return <TelegramIcon className={iconClass} />
    case 'facebook-page':
    case 'facebook_page':
      return <FacebookPageIcon className={iconClass} />
    case 'facebook-messenger':
    case 'facebook_messenger':
      return <FacebookMessengerIcon className={iconClass} />
    default:
      return <Bot className={iconClass} />
  }
}

// ============================================================================
// Platform Brand Colors
// ============================================================================

// Map platforms to their official brand colors, mirroring the Home page aesthetics
function getPlatformColors(platform: string) {
  switch (platform) {
    case 'discord':
      return 'bg-[#5865F2]/10 text-[#5865F2]'
    case 'telegram':
      return 'bg-[#26A5E4]/10 text-[#26A5E4]'
    case 'facebook-page':
    case 'facebook_page':
      return 'bg-[#0866FF]/10 text-[#0866FF]'
    case 'facebook-messenger':
    case 'facebook_messenger':
      return 'bg-[#0084FF]/10 text-[#0084FF]'
    default:
      return 'bg-primary-container text-on-primary-container'
  }
}

// ============================================================================
// BotCard
// ============================================================================

function BotCard({
  bot,
  onClick,
  isActive,
}: {
  bot: GetBotListItemDto
  onClick: () => void
  /** Live active/inactive state from the bot runtime's session manager. */
  isActive: boolean
}) {
  const statusColor = isActive ? ('success' as const) : ('error' as const)
  const statusLabel = isActive ? 'Online' : 'Offline'
  const platformColors = getPlatformColors(bot.platform)

  return (
    <Card.Root
      variant="elevated"
      shadowElevation={1}
      padding="md"
      interactive
      onClick={onClick}
    >
      {/* Identity + live status */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${platformColors}`}>
            {getPlatformIcon(bot.platform)}
          </span>
          <div className="min-w-0">
            <p className="text-title-md font-semibold text-on-surface truncate">
              {bot.nickname}
            </p>
            <p className="mt-0.5 text-body-sm text-on-surface-variant">
              {getPlatformLabel(bot.platform)}
            </p>
          </div>
        </div>

        {/* Status shown top-right so operators can scan bot health at a glance */}
        <Status.Root colorPalette={statusColor} size="sm">
          <Status.Indicator
            colorPalette={statusColor}
            size="sm"
            pulse={isActive}
          />
          {statusLabel}
        </Status.Root>
      </div>

      {/* Prefix badge + chevron affordance — signals the card is clickable */}
      <div className="mt-4 flex items-center justify-between">
        <Badge
          variant="tonal"
          color="default"
          className="font-mono text-label-sm"
        >
          <span className="text-on-surface-variant/60 mr-1">prefix</span>
          {bot.prefix}
        </Badge>
        <ChevronRight className="h-4 w-4 text-on-surface-variant/40" />
      </div>
    </Card.Root>
  )
}

// ============================================================================
// BotCardSkeleton
// ============================================================================

/**
 * Content-shaped placeholder rendered while bots are loading.
 * Mirrors the BotCard layout so there's no layout shift on resolve.
 */
function BotCardSkeleton() {
  return (
    <Card.Root variant="elevated" padding="md" shadowElevation={1}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="flex flex-col gap-2 pt-0.5">
            <Skeleton textSize="title-md" width="128px" />
            <Skeleton textSize="body-sm" width="80px" />
          </div>
        </div>
        <Skeleton variant="rounded" width="64px" height="22px" />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Skeleton variant="rounded" width="90px" height="26px" />
        <Skeleton variant="circular" width={16} height={16} />
      </div>
    </Card.Root>
  )
}

// ============================================================================
// Page
// ============================================================================

/**
 * Bot Manager page.
 *
 * Displays all configured bot sessions fetched from the server.
 * Uses Skeleton cards during load to prevent layout shift, EmptyState
 * for the zero-bots case, and Stat blocks for the fleet health summary.
 */
export default function BotManagerPage() {
  const navigate = useNavigate()
  const { bots, isLoading, error } = useBotList()

  // Derive sessionIds once per bots-array change so useBotStatus gets a stable input
  const sessionIds = useMemo(() => bots.map((b) => b.sessionId), [bots])
  const botStatuses = useBotStatus(sessionIds)

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-headline-md font-semibold text-on-surface">
            Bot Manager
          </h1>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Configure and monitor your deployed bots.
          </p>
        </div>

        <Button
          variant="filled"
          color="primary"
          size="md"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => navigate(ROUTES.DASHBOARD.CREATE_NEW_BOT)}
        >
          Create New Bot
        </Button>
      </div>

      {/* ── Loading — skeleton grid mirrors final card layout ────────────── */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BotCardSkeleton />
          <BotCardSkeleton />
          <BotCardSkeleton />
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {!isLoading && error !== null && (
        <Alert
          variant="tonal"
          color="error"
          title="Error loading bots"
          message={error}
        />
      )}

      {/* ── Empty — EmptyState provides a guided call-to-action ───────── */}
      {!isLoading && error === null && bots.length === 0 && (
        <EmptyState
          icon={Bot}
          title="No bots configured yet"
          description="Create your first bot to start managing your messaging platforms."
          action={{
            label: 'Create New Bot',
            onClick: () => navigate(ROUTES.DASHBOARD.CREATE_NEW_BOT),
            icon: <Plus className="h-4 w-4" />,
          }}
        />
      )}

      {/* ── Bot grid ───────────────────────────────────────────────────── */}
      {!isLoading && bots.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => (
            <BotCard
              key={bot.sessionId}
              bot={bot}
              onClick={() =>
                navigate(`${ROUTES.DASHBOARD.BOT}?id=${bot.sessionId}`)
              }
              isActive={botStatuses[bot.sessionId]?.active ?? false}
            />
          ))}
        </div>
      )}
    </div>
  )
}
