import React, { useState, useEffect, useRef } from 'react'
import { Terminal, Clock, Layers, Hash, Users, Activity } from 'lucide-react'
import _AnsiLib from 'ansi-to-react'
import Card from '@/components/ui/data-display/Card'
import ScrollArea from '@/components/ui/data-display/ScrollArea'
import Status from '@/components/ui/data-display/Status'
import Stat from '@/components/ui/data-display/Stat'
import { cn } from '@/utils/cn.util'
import Button from '@/components/ui/buttons/Button'
import { getPlatformLabel } from '@/utils/bot.util'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotLogs } from '@/features/users/hooks/useBotLogs'
import { botService } from '@/features/users/services/bot.service'

const Ansi =
  (
    _AnsiLib as unknown as {
      default: React.FC<{ children: string; className?: string }>
    }
  ).default ??
  (_AnsiLib as unknown as React.FC<{ children: string; className?: string }>)

// ── Uptime ticker ─────────────────────────────────────────────────────────────
function UptimeDisplay({ startedAt }: { startedAt: number }) {
  const [uptime, setUptime] = useState('')

  useEffect(() => {
    const tick = () => {
      const diff = Math.floor((Date.now() - startedAt) / 1000)
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setUptime(`${h}h ${m}m ${s}s`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  return <>{uptime}</>
}

// ── Sidebar metric card ────────────────────────────────────────────────────────
function InfoCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <Card.Root padding="sm" shadowElevation={1}>
      <div className="flex items-center gap-4">
        <div className="text-on-surface-variant p-2 shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]">
          {icon}
        </div>
        <Stat.Root size="sm" className="flex-1 min-w-0 overflow-hidden">
          <Stat.Label>{label}</Stat.Label>
          {children}
        </Stat.Root>
      </div>
    </Card.Root>
  )
}

/**
 * Console Page — /dashboard/bot?id=xxx
 * Handles real-time logs and bot lifecycle commands.
 */
export default function BotConsolePage() {
  const { bot, isActive, startedAt, id } = useBotContext()
  const sessionKey = bot ? `${bot.userId}:${bot.platformId}:${bot.sessionId}` : undefined
  const { logs, clearLogs } = useBotLogs(sessionKey)

  // Scroll anchor ref
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    el.parentElement?.scrollTo({ top: el.parentElement.scrollHeight, behavior: 'smooth' })
  }, [logs])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-headline-sm font-semibold text-on-surface leading-none">
            {bot.nickname}
          </h2>
        </div>

        <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="filled"
            color="success"
            onClick={() => void botService.startBot(id)}
            disabled={isActive}
            className="w-full justify-center"
          >
            Start
          </Button>
          <Button
            color="primary"
            onClick={() => { clearLogs(); void botService.restartBot(id) }}
            disabled={!isActive}
            className="w-full justify-center"
          >
            Restart
          </Button>
          <Button
            onClick={() => { clearLogs(); void botService.stopBot(id) }}
            disabled={!isActive}
            className="!bg-[rgb(var(--light-color-error))] !text-[rgb(var(--light-color-surface))] w-full justify-center"
          >
            Stop
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="w-full lg:flex-1 min-w-0 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-black border-b border-gray-800">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <span className="text-label-sm text-gray-400 font-mono truncate">
                {bot.nickname} — live feed
              </span>
            </div>
          </div>

          <ScrollArea.Root className="bg-black" style={{ height: '26rem' }}>
            <ScrollArea.Viewport className="p-4 flex flex-col gap-0">
              {logs.length === 0 ? (
                <p className="text-body-sm text-gray-600 italic">
                  Waiting for log entries…
                </p>
              ) : (
                logs.map((line, i) => (
                  <Ansi
                    key={i}
                    className={cn(
                      'font-mono text-xs sm:text-sm leading-relaxed bg-black break-all whitespace-pre-wrap',
                    )}
                  >
                    {line}
                  </Ansi>
                ))
              )}
              <div ref={bottomRef} />
            </ScrollArea.Viewport>
          </ScrollArea.Root>
        </div>

        <div className="w-full lg:w-60 shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-col gap-4">
          <InfoCard icon={<Activity />} label="Status">
            <Status.Root
              as="div"
              colorPalette={isActive ? 'success' : 'error'}
              size="sm"
            >
              <Status.Indicator
                colorPalette={isActive ? 'success' : 'error'}
                size="sm"
                pulse={isActive}
              />
              {isActive ? 'Online' : 'Offline'}
            </Status.Root>
          </InfoCard>

          <InfoCard icon={<Clock />} label="Uptime">
            <Stat.ValueText
              as="div"
              className={cn('truncate', !isActive && 'text-on-surface-variant')}
            >
              {isActive && startedAt ? (
                <UptimeDisplay startedAt={startedAt} />
              ) : (
                'Offline'
              )}
            </Stat.ValueText>
          </InfoCard>

          <InfoCard icon={<Layers />} label="Platform">
            <Stat.ValueText as="div" className="truncate">
              {getPlatformLabel(bot.platform)}
            </Stat.ValueText>
          </InfoCard>

          <InfoCard icon={<Hash />} label="Prefix">
            <Stat.ValueText as="div" className="truncate font-mono">
              {bot.prefix}
            </Stat.ValueText>
          </InfoCard>

          <InfoCard icon={<Users />} label="Bot Admins">
            <Stat.ValueText as="div" className="truncate">
              {bot.admins.length === 0 ? '—' : String(bot.admins.length)}
            </Stat.ValueText>
          </InfoCard>
        </div>
      </div>
    </div>
  )
}