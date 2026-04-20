import { useState } from 'react'
import { Search } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Badge from '@/components/ui/data-display/Badge'
import Alert from '@/components/ui/feedback/Alert'
import Progress from '@/components/ui/feedback/Progress'
import Switch from '@/components/ui/forms/Switch'
import Input from '@/components/ui/forms/Input'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotCommands } from '@/features/users/hooks/useBotCommands'

const ROLE_LABEL: Record<number, string> = {
  0: 'Anyone',
  1: 'Group Admin',
  2: 'Bot Admin',
  3: 'Premium',
  4: 'System Admin'
}

/**
 * Commands Page — /dashboard/bot/commands?id=xxx
 * Decouples the command fetching so the layout does not re-render.
 */
export default function BotCommandsPage() {
  const { bot, id } = useBotContext()
  const { commands, isLoading, error, toggleCommand } = useBotCommands(id)
  
  const [query, setQuery] = useState('')

  if (isLoading) return <Progress.Circular message="Loading commands…" />

  const filtered =
    query.trim() === ''
      ? commands
      : commands.filter(
          (cmd) =>
            cmd.commandName.toLowerCase().includes(query.toLowerCase()) ||
            cmd.description?.toLowerCase().includes(query.toLowerCase()),
        )

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="tonal" color="error" title="Error" message={error} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-title-md font-semibold text-on-surface">
            Commands
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Enable or disable commands for this session. Disabled commands are
            skipped during dispatch.
          </p>
        </div>
        <Badge color="secondary" size="sm" variant="tonal">
          {query.trim()
            ? `${filtered.length} of ${commands.length}`
            : `${commands.length} total`}
        </Badge>
      </div>

      <div className="bg-surface p-2 rounded-full">
        <Input
          placeholder="Search commands…"
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
              ? `No commands match "${query}"`
              : 'No commands synced yet — start the bot to populate this list.'}
          </p>
        </Card.Root>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((cmd) => (
            <Card.Root
              key={cmd.commandName}
              padding="sm"
              className={[
                'flex flex-col gap-3 transition-opacity duration-fast',
                !cmd.isEnable ? 'opacity-60' : '',
              ].join(' ')}
              bordered
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1.5 min-w-0">
                  <span className="font-mono text-label-lg font-semibold text-on-surface truncate">
                    {bot.prefix}
                    {cmd.commandName}
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge
                      color={cmd.isEnable ? 'success' : 'secondary'}
                      size="sm"
                      variant="tonal"
                    >
                      {cmd.isEnable ? 'ON' : 'OFF'}
                    </Badge>
                    {cmd.role !== undefined && (
                      <Badge color="primary" size="sm" variant="outlined">
                        {ROLE_LABEL[cmd.role] ?? 'Unknown'}
                      </Badge>
                    )}
                    {cmd.version && (
                      <span className="text-label-sm text-on-surface-variant">
                        v{cmd.version}
                      </span>
                    )}
                  </div>
                </div>
                <Switch
                  checked={cmd.isEnable}
                  onChange={() =>
                    void toggleCommand(cmd.commandName, !cmd.isEnable)
                  }
                />
              </div>

              {cmd.description && (
                <p className="text-body-sm text-on-surface-variant leading-relaxed line-clamp-2">
                  {cmd.description}
                </p>
              )}

              {(cmd.usage ??
                (cmd.cooldown !== undefined && cmd.cooldown > 0) ??
                cmd.aliases?.length ??
                cmd.author) && (
                <div className="flex flex-col gap-1 pt-2 border-t border-outline-variant text-label-sm text-on-surface-variant">
                  {cmd.usage && (
                    <div className="flex gap-1 items-baseline min-w-0">
                      <span className="font-medium text-on-surface shrink-0">
                        Usage:
                      </span>
                      <span className="font-mono truncate">
                        {bot.prefix}
                        {cmd.commandName} {cmd.usage}
                      </span>
                    </div>
                  )}
                  {cmd.cooldown !== undefined && cmd.cooldown > 0 && (
                    <div className="flex gap-1">
                      <span className="font-medium text-on-surface">
                        Cooldown:
                      </span>
                      <span>{cmd.cooldown}s</span>
                    </div>
                  )}
                  {cmd.aliases && cmd.aliases.length > 0 && (
                    <div className="flex gap-1 min-w-0">
                      <span className="font-medium text-on-surface shrink-0">
                        Aliases:
                      </span>
                      <span className="truncate">
                        {cmd.aliases.map((a) => bot.prefix + a).join(', ')}
                      </span>
                    </div>
                  )}
                  {cmd.author && (
                    <div className="flex gap-1">
                      <span className="font-medium text-on-surface">
                        Author:
                      </span>
                      <span>{cmd.author}</span>
                    </div>
                  )}
                </div>
              )}
            </Card.Root>
          ))}
        </div>
      )}
    </div>
  )
}