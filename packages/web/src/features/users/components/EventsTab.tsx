import { useState } from 'react'
import { Search } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Badge from '@/components/ui/data-display/Badge'
import Alert from '@/components/ui/feedback/Alert'
import Progress from '@/components/ui/feedback/Progress'
import Switch from '@/components/ui/forms/Switch'
import Input from '@/components/ui/forms/Input'
import type { BotEventItemDto } from '@/features/users/dtos/bot.dto'

export interface EventsTabProps {
  events: BotEventItemDto[]
  isLoading: boolean
  error: string | null
  toggleEvent: (name: string, isEnable: boolean) => Promise<void>
}

/**
 * Renders per-session event modules as a responsive card grid, mirroring
 * CommandsTab's layout. Events have a simpler anatomy (no usage/aliases/cooldown)
 * so cards are shorter and the grid reads even more cleanly.
 */
export function EventsTab({
  events,
  isLoading,
  error,
  toggleEvent,
}: EventsTabProps) {
  // Local query state — client-side filter; event list is already in memory, no round-trip needed
  const [query, setQuery] = useState('')

  if (isLoading) return <Progress.Circular message="Loading events…" />

  // Derive visible subset on each render; empty query passes everything through unchanged
  const filtered =
    query.trim() === ''
      ? events
      : events.filter(
          (evt) =>
            evt.eventName.toLowerCase().includes(query.toLowerCase()) ||
            evt.description?.toLowerCase().includes(query.toLowerCase()),
        )

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="tonal" color="error" title="Error" message={error} />
      )}

      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-title-md font-semibold text-on-surface">
            Events
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Enable or disable event handler modules. Disabled modules are
            skipped during dispatch.
          </p>
        </div>
        <Badge color="secondary" size="sm" variant="tonal">
          {query.trim()
            ? `${filtered.length} of ${events.length}`
            : `${events.length} total`}
        </Badge>
      </div>

      <div className="bg-surface p-2 rounded-full">
        {/* Search — filters the in-memory list; no refetch since the full event set is already loaded */}
        <Input
          placeholder="Search events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
          pill
        />
      </div>

      {filtered.length === 0 ? (
        <Card.Root padding="lg">
          <p className="text-body-md text-on-surface-variant italic text-center">
            {query.trim()
              ? `No events match "${query}"`
              : 'No events synced yet — start the bot to populate this list.'}
          </p>
        </Card.Root>
      ) : (
        // 3-col responsive grid — mirrors CommandsTab breakpoints for visual consistency
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((evt) => (
            <Card.Root
              key={evt.eventName}
              padding="sm"
              className={[
                'flex flex-col gap-3 transition-opacity duration-fast',
                !evt.isEnable ? 'opacity-60' : '',
              ].join(' ')}
              bordered
            >
              {/* Card header: event name + live toggle */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1.5 min-w-0">
                  <span className="font-mono text-label-lg font-semibold text-on-surface truncate">
                    {evt.eventName}
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge
                      color={evt.isEnable ? 'success' : 'secondary'}
                      size="sm"
                      variant="tonal"
                    >
                      {evt.isEnable ? 'ON' : 'OFF'}
                    </Badge>
                    {evt.version && (
                      <span className="text-label-sm text-on-surface-variant">
                        v{evt.version}
                      </span>
                    )}
                  </div>
                </div>
                <Switch
                  checked={evt.isEnable}
                  onChange={() =>
                    void toggleEvent(evt.eventName, !evt.isEnable)
                  }
                />
              </div>

              {/* Description — clamped to 3 lines; events tend to have shorter descriptions */}
              {evt.description && (
                <p className="text-body-sm text-on-surface-variant leading-relaxed line-clamp-3">
                  {evt.description}
                </p>
              )}

              {/* Author footer */}
              {evt.author && (
                <div className="flex gap-1 pt-2 border-t border-outline-variant text-label-sm text-on-surface-variant">
                  <span className="font-medium text-on-surface">Author:</span>
                  <span>{evt.author}</span>
                </div>
              )}
            </Card.Root>
          ))}
        </div>
      )}
    </div>
  )
}
