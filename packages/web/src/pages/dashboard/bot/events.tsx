import { useState } from 'react'
import { Search } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Badge from '@/components/ui/data-display/Badge'
import Alert from '@/components/ui/feedback/Alert'
import Switch from '@/components/ui/forms/Switch'
import Input from '@/components/ui/forms/Input'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotEvents } from '@/features/users/hooks/useBotEvents'
import Skeleton from '@/components/ui/feedback/Skeleton'

/**
 * Events Page — /dashboard/bot/events?id=xxx
 * Decoupled route to isolate fetching scope for events.
 */
export default function BotEventsPage() {
  const { id } = useBotContext()
  const { events, isLoading, error, toggleEvent } = useBotEvents(id)

  const [query, setQuery] = useState('')

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
          {isLoading
            ? 'Loading...'
            : query.trim()
              ? `${filtered.length} of ${events.length}`
              : `${events.length} total`}
        </Badge>
      </div>

      <div className="bg-surface p-2 rounded-full">
        <Input
          placeholder="Search events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
          pill
        />
      </div>

      {/* Keep contextual search bar visible; swap only the grid for skeletons while fetching */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card.Root key={i} padding="sm" bordered className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1.5 flex-1">
                  <Skeleton variant="text" width="60%" height="24px" />
                  <Skeleton variant="text" width="40%" height="20px" />
                </div>
                <Skeleton variant="rounded" width="44px" height="24px" className="rounded-full" />
              </div>
              <Skeleton variant="text" count={2} />
              <div className="pt-2 border-t border-outline-variant mt-auto">
                <Skeleton variant="text" width="50%" />
              </div>
            </Card.Root>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card.Root padding="lg">
          <p className="text-body-md text-on-surface-variant italic text-center">
            {query.trim()
              ? `No events match "${query}"`
              : 'No events synced yet — start the bot to populate this list.'}
          </p>
        </Card.Root>
      ) : (
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

              {evt.description && (
                <p className="text-body-sm text-on-surface-variant leading-relaxed line-clamp-3">
                  {evt.description}
                </p>
              )}

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
