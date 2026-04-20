import React from 'react'
import { useState, useEffect, useRef } from 'react'
import { Terminal, Clock, Layers, Hash, Users, Activity } from 'lucide-react'
import _AnsiLib from 'ansi-to-react'
import Card from '@/components/ui/data-display/Card'
import ScrollArea from '@/components/ui/data-display/ScrollArea'
import Status from '@/components/ui/data-display/Status'
import Stat from '@/components/ui/data-display/Stat'
import { cn } from '@/utils/cn.util'
import Button from '@/components/ui/buttons/Button'
import type { GetBotDetailResponseDto } from '@/features/users/dtos/bot.dto'
import { getPlatformLabel } from '@/utils/bot.util'

// ansi-to-react ships as CommonJS; Vite's ESM interop wraps it so the default
// import may resolve to { default: Component } rather than Component directly.
const Ansi =
  (
    _AnsiLib as unknown as {
      default: React.FC<{ children: string; className?: string }>
    }
  ).default ??
  (_AnsiLib as unknown as React.FC<{ children: string; className?: string }>)

// ── Uptime ticker ─────────────────────────────────────────────────────────────
// Isolated component so the 1-second interval only re-renders this span,
// not the entire console list.

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

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ConsoleTabProps {
  bot: GetBotDetailResponseDto
  logs: string[]
  /** Reflects the live socket status of this session — controls which lifecycle buttons are enabled. */
  isActive: boolean
  startedAt: number | null
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  /** When provided, clears the in-memory log buffer and the server-side session history;
   *  called on Stop and Restart so the console view starts clean after each lifecycle event. */
  clearLogs?: () => void
  /** Pre-computed count of enabled commands — passed from parent to avoid a second fetch. */
  enabledCommandsCount?: number
  /** Pre-computed count of enabled events — same derivation pattern. */
  enabledEventsCount?: number
}

// ── Sidebar metric card ────────────────────────────────────────────────────────
// Mirrors Pterodactyl's compact info panels: icon left, label + value right.
// Uses Card.Root + Stat.Root so the full design-token surface system applies.

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

// ── ConsoleTab ─────────────────────────────────────────────────────────────────
// Pterodactyl-style layout:
//   Row 1 — nickname + live status dot (left) | Start / Restart / Stop (right)
//   Row 2 — ANSI log console (flex-1) | stacked metric cards (fixed sidebar)
//
// Isolated from sibling tab panels so socket-driven log updates only re-render
// the console feed and the uptime ticker, not the Commands or Events panels.

export function ConsoleTab({
  bot,
  logs,
  isActive,
  startedAt,
  onStart,
  onStop,
  onRestart,
  clearLogs,
}: ConsoleTabProps) {
  // Scroll anchor ref — scrollIntoView fires after every log state update to keep the
  // console pinned to the latest entry without the user needing to scroll manually.
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    // scrollIntoView propagates up the entire DOM ancestor chain and will scroll
    // the document itself on mobile, causing the whole page to jump. Targeting
    // parentElement (the ScrollArea.Viewport div) scopes the scroll to the
    // terminal container only.
    el.parentElement?.scrollTo({ top: el.parentElement.scrollHeight, behavior: 'smooth' })
  }, [logs])
  return (
    <div className="flex flex-col gap-4">
      {/* ── Header: nickname + status indicator (left) | lifecycle buttons (right) ── */}
      {/* Switch to column on mobile to let buttons span full width, row on desktop */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-headline-sm font-semibold text-on-surface leading-none">
            {bot.nickname}
          </h2>
        </div>

        {/* Start only when offline; Restart/Stop only when online — prevent duplicate transports */}
        {/* Use a 3-column grid on mobile for evenly sized touch targets */}
        <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="filled"
            color="success"
            onClick={onStart}
            disabled={isActive}
            className="w-full justify-center"
          >
            Start
          </Button>
          <Button
            color="primary"
            onClick={() => { clearLogs?.(); onRestart() }}
            disabled={!isActive}
            className="w-full justify-center"
          >
            Restart
          </Button>
          <Button
            onClick={() => { clearLogs?.(); onStop() }}
            disabled={!isActive}
            className="!bg-[rgb(var(--light-color-error))] !text-[rgb(var(--light-color-surface))] w-full justify-center"
          >
            Stop
          </Button>
        </div>
      </div>

      {/* ── Body: console panel (flex-1 left) | metric sidebar (fixed right) ── */}
      {/* Stack vertically on mobile, side-by-side on desktop */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Console — bg-black required; ANSI colour codes are calibrated for black terminals */}
        <div className="w-full lg:flex-1 min-w-0 rounded-lg overflow-hidden">
          {/* Terminal chrome: filename/session label left, inline clear button right */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-black border-b border-gray-800">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <span className="text-label-sm text-gray-400 font-mono truncate">
                {bot.nickname} — live feed
              </span>
            </div>
          </div>

          {/* gap-0: real terminals have zero inter-line gap — line-height controls spacing */}
          <ScrollArea.Root className="bg-black" style={{ height: '26rem' }}>
            <ScrollArea.Viewport className="p-4 flex flex-col gap-0">
              {logs.length === 0 ? (
                <p className="text-body-sm text-gray-600 italic">
                  Waiting for log entries…
                </p>
              ) : (
                logs.map((line, i) => (
                  // Each line is a raw ANSI string from Winston devFormat — ansi-to-react
                  // converts escape codes to <span> elements with inline colour styles.
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
              {/* Auto-scroll anchor — bottomRef.scrollIntoView() is called after each log state update */}
              <div ref={bottomRef} />
            </ScrollArea.Viewport>
          </ScrollArea.Root>
        </div>

        {/* Metric sidebar — Pterodactyl-style stacked info cards */}
        {/* 1-col on mobile, 2-col grid on tablet, stacked column on desktop sidebar */}
        <div className="w-full lg:w-60 shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-col gap-4">
          {/* Status */}
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

          {/* Uptime — ticks live when session is active */}
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

          {/* Platform */}
          <InfoCard icon={<Layers />} label="Platform">
            <Stat.ValueText as="div" className="truncate">
              {getPlatformLabel(bot.platform)}
            </Stat.ValueText>
          </InfoCard>

          {/* Prefix — monospace so the trigger character reads like a command prompt */}
          <InfoCard icon={<Hash />} label="Prefix">
            <Stat.ValueText as="div" className="truncate font-mono">
              {bot.prefix}
            </Stat.ValueText>
          </InfoCard>

          {/* Bot Admins — count only; full list lives in Settings tab */}
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
