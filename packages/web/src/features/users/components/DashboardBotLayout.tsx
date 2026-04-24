import { Helmet } from '@dr.pogodin/react-helmet'
import {
  useSearchParams,
  useNavigate,
  useLocation,
  Outlet,
  useOutletContext,
} from 'react-router-dom'
import { Bot, ArrowLeft } from 'lucide-react'
import Tabs from '@/components/ui/navigation/Tabs'
import Progress from '@/components/ui/feedback/Progress'
import Button from '@/components/ui/buttons/Button'
import { ROUTES } from '@/constants/routes.constants'

import { useBotDetail } from '@/features/users/hooks/useBotDetail'
import { useBotStatus } from '@/features/users/hooks/useBotStatus'
import type { GetBotDetailResponseDto } from '@/features/users/dtos/bot.dto'

export interface BotContextType {
  bot: GetBotDetailResponseDto
  setBot: (bot: GetBotDetailResponseDto) => void
  isActive: boolean
  startedAt: number | null
  id: string
}

/**
 * Custom hook to consume the bot context provided by the BotLayout.
 * Sub-pages (Console, Commands, Events, Settings) use this to avoid re-fetching data.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useBotContext() {
  return useOutletContext<BotContextType>()
}

/**
 * Bot detail layout wrapper — reached via /dashboard/bot?id=<id>
 *
 * Provides the core bot fetching state and the global Tabs navigation header.
 * Uses <Outlet> to render the active tab as a nested React Router page.
 */
export default function BotLayout() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = searchParams.get('id') ?? ''

  const botStatuses = useBotStatus(id ? [id] : [])
  const { bot, setBot, isLoading, error } = useBotDetail(id)

  const botStatus = botStatuses[id] ?? { active: false, startedAt: null }
  const isActive = botStatus.active
  const startedAt = botStatus.startedAt

  // Determine active tab from URL path
  const pathParts = location.pathname.split('/')
  const lastSegment = pathParts[pathParts.length - 1]
  const currentTab = lastSegment === 'bot' ? 'console' : lastSegment

  const handleTabChange = (value: string) => {
    // Preserve the ?id query param across tab navigation
    if (value === 'console') {
      navigate(`${ROUTES.DASHBOARD.BOT}?id=${id}`)
    } else {
      navigate(`${ROUTES.DASHBOARD.BOT}/${value}?id=${id}`)
    }
  }

  if (isLoading) {
    return <Progress.Circular fullScreen message="Loading bot details..." />
  }

  // Missing or unknown bot ID — surface a clear recovery path instead of a blank page
  if (error || !bot) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-on-surface">
        <Bot className="h-12 w-12 text-on-surface-variant/40" />
        <p className="text-headline-sm font-medium">
          {error || 'Bot not found'}
        </p>
        <p className="text-body-md text-on-surface-variant">
          No bot exists with ID <code>{id || '(empty)'}</code>.
        </p>
        <Button
          variant="tonal"
          color="primary"
          size="lg"
          leftIcon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => navigate(ROUTES.DASHBOARD.ROOT)}
        >
          Back to Bot Manager
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Dynamic title shows which bot is open */}
      <Helmet>
        <title>{bot.nickname} · Cat-Bot</title>
      </Helmet>

      {/* Controlled tabs navigating React Router underneath */}
      <Tabs.Root value={currentTab} onChange={handleTabChange}>
        <Tabs.List variant="line">
          <Tabs.Tab value="console">Console</Tabs.Tab>
          <Tabs.Tab value="commands">Commands</Tabs.Tab>
          <Tabs.Tab value="events">Events</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>

      {/* Outlet renders the specific page chunk, wrapped in animation classes matching Tabs.Panel */}
      <div className="focus-visible:outline-none animate-in fade-in duration-normal">
        <Outlet
          context={
            { bot, setBot, isActive, startedAt, id } satisfies BotContextType
          }
        />
      </div>
    </div>
  )
}
