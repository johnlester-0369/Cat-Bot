import { Helmet } from '@dr.pogodin/react-helmet'
import { Link } from 'react-router-dom'
import { ArrowRight, Zap, Bot, LayoutDashboard, Globe } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'

// ── Platform brand icons ────────────────────────────────────────────────────
// Inline SVGs from Simple Icons (simpleicons.org). aria-hidden because the
// platform name is always rendered as adjacent text — purely decorative.

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

// ── Static data ─────────────────────────────────────────────────────────────

const PLATFORMS = [
  {
    name: 'Discord',
    Icon: DiscordIcon,
    // Discord brand blue — outside the design token system, scoped to decorative badges only
    bg: 'bg-[#5865F2]/10 text-[#5865F2]',
  },
  {
    name: 'Telegram',
    Icon: TelegramIcon,
    bg: 'bg-[#26A5E4]/10 text-[#26A5E4]',
  },
  {
    name: 'Facebook Page',
    Icon: FacebookPageIcon,
    bg: 'bg-[#0866FF]/10 text-[#0866FF]',
  },
  {
    name: 'Messenger',
    Icon: FacebookMessengerIcon,
    bg: 'bg-[#0084FF]/10 text-[#0084FF]',
  },
] as const

const FEATURES = [
  {
    Icon: Globe,
    title: 'Multi-Platform',
    description:
      'One codebase that runs natively on Discord, Telegram, Facebook Page, and Facebook Messenger — no per-platform rewrites.',
  },
  {
    Icon: Bot,
    title: 'Multi-Bot Management',
    description:
      'Run multiple independent bot sessions simultaneously, each with its own commands, prefix, and admin roster.',
  },
  {
    Icon: LayoutDashboard,
    title: 'Unified Dashboard',
    description:
      'Monitor live logs, enable or disable commands per session, and update credentials — all from one place.',
  },
  {
    Icon: Zap,
    title: 'Live Session Control',
    description:
      'Start, stop, and hot-restart any bot session without touching the server or redeploying code.',
  },
] as const

// ── Page ─────────────────────────────────────────────────────────────────────

/**
 * Home / landing page — visible to unauthenticated visitors via the public Layout.
 *
 * Three sections:
 *   1. Hero      — headline, platform badges, fake dashboard widget, CTAs
 *   2. Features  — four capability cards
 *   3. Bottom CTA — single sign-up nudge
 *
 * All animations use the 'fade-in-down' keyframe already defined in animations.css,
 * with staggered animation-delay values for a choreographed reveal.
 */
export default function HomePage() {
  const { isAuthenticated } = useUserAuth()

  return (
    <div className="flex flex-col">
      {/* Sets the browser tab title for the public landing page */}
      <Helmet>
        <title>Cat-Bot</title>
      </Helmet>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden min-h-[calc(100vh-64px)] flex items-center">
        {/* Dot-grid atmosphere: subtle enough not to compete with copy */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgb(var(--color-outline-variant) / 0.6) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        {/* Soft primary glow in the top-left quadrant — depth without noise */}
        <div className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-primary/5 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-[400px] w-[400px] rounded-full bg-tertiary/5 blur-3xl" />

        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            {/* ── Left: copy column ─────────────────────────────────────── */}
            <div className="flex flex-col gap-8">
              {/* Lozenge badge — frames the value prop before the headline lands */}
              <div
                className="inline-flex items-center gap-2 w-fit rounded-full border border-outline-variant bg-surface px-3.5 py-1.5 shadow-elevation-1"
                style={{
                  animation:
                    'fade-in-down 400ms var(--easing-emphasized-decelerate) both',
                }}
              >
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                <span className="text-label-sm font-medium text-on-surface-variant">
                  Multi-platform · Multi-bot · Open source
                </span>
              </div>

              {/* Headline — primary color on the key differentiator phrase */}
              <div className="flex flex-col gap-3">
                <h1
                  className="font-brand text-display-sm font-semibold text-on-surface leading-[1.1] tracking-tight"
                  style={{
                    animation:
                      'fade-in-down 500ms 100ms var(--easing-emphasized-decelerate) both',
                  }}
                >
                  Write once.
                  <br />
                  <span className="text-primary">Deploy everywhere.</span>
                </h1>
                <p
                  className="text-body-lg text-on-surface-variant max-w-lg leading-relaxed"
                  style={{
                    animation:
                      'fade-in-down 500ms 200ms var(--easing-emphasized-decelerate) both',
                  }}
                >
                  Cat-Bot is a unified chatbot framework that runs across
                  Discord, Telegram, Facebook Page, and Facebook Messenger — all
                  from a single codebase. Manage multiple independent bot
                  sessions from one powerful dashboard.
                </p>
              </div>

              {/* Platform badge row — visual scan confirms supported platforms instantly */}
              <div
                className="flex flex-wrap gap-2"
                style={{
                  animation:
                    'fade-in-down 500ms 300ms var(--easing-emphasized-decelerate) both',
                }}
              >
                {PLATFORMS.map((p) => (
                  <span
                    key={p.name}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label-sm font-medium ${p.bg}`}
                  >
                    <p.Icon className="h-3.5 w-3.5" />
                    {p.name}
                  </span>
                ))}
              </div>

              {/* Primary CTA pair */}
              <div
                className="flex flex-wrap items-center gap-3"
                style={{
                  animation:
                    'fade-in-down 500ms 400ms var(--easing-emphasized-decelerate) both',
                }}
              >
                {isAuthenticated ? (
                  // Highlight active session path on the hero section
                  <Button
                    as={Link}
                    to={ROUTES.DASHBOARD.ROOT}
                    variant="filled"
                    color="primary"
                    size="lg"
                    leftIcon={<LayoutDashboard className="h-4 w-4" />}
                  >
                    Go to Dashboard
                  </Button>
                ) : (
                  <>
                    <Button
                      as={Link}
                      to={ROUTES.SIGNUP}
                      variant="filled"
                      color="primary"
                      size="lg"
                      leftIcon={<ArrowRight className="h-4 w-4" />}
                    >
                      Get Started Free
                    </Button>
                    <Button
                      as={Link}
                      to={ROUTES.LOGIN}
                      variant="outline"
                      color="primary"
                      size="lg"
                    >
                      Sign In
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* ── Right: fake dashboard widget ──────────────────────────── */}
            {/* Hidden on mobile — space is needed for the copy; appears on lg+ */}
            <div
              className="hidden lg:block"
              style={{
                animation:
                  'fade-in-down 600ms 200ms var(--easing-emphasized-decelerate) both',
              }}
            >
              {/* Terminal-chrome wrapper — mirrors the ConsoleTab visual language */}
              <div className="rounded-2xl overflow-hidden border border-outline-variant bg-surface shadow-elevation-3">
                {/* Chrome bar */}
                <div className="flex items-center gap-3 border-b border-outline-variant bg-surface-container px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-error/60" />
                    <span className="h-3 w-3 rounded-full bg-warning/60" />
                    <span className="h-3 w-3 rounded-full bg-success/60" />
                  </div>
                  <span className="ml-1 font-mono text-label-sm text-on-surface-variant">
                    cat-bot — bot manager
                  </span>
                </div>

                {/* Bot session list — simulates the dashboard index cards */}
                <div className="flex flex-col gap-0 p-4">
                  <p className="mb-3 text-label-sm font-medium text-on-surface-variant uppercase tracking-wider">
                    Active Sessions
                  </p>
                  {PLATFORMS.map((p, i) => (
                    <div
                      key={p.name}
                      className="flex items-center justify-between rounded-xl p-3 border border-outline-variant/40 bg-surface-container-low mb-3 last:mb-0"
                      style={{
                        // Stagger each row for a cascading reveal effect
                        animation: `fade-in-down 400ms ${380 + i * 70}ms var(--easing-emphasized-decelerate) both`,
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${p.bg}`}
                        >
                          <p.Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-label-md font-semibold text-on-surface">
                            {p.name} Bot
                          </p>
                          <p className="text-label-sm text-on-surface-variant font-mono">
                            prefix: /
                          </p>
                        </div>
                      </div>
                      {/* Live status indicator */}
                      <span className="inline-flex items-center gap-1.5 text-label-sm text-success font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                        Online
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-surface-container-low border-y border-outline-variant">
        <div className="max-w-6xl mx-auto flex flex-col gap-14">
          <div className="flex flex-col gap-3 text-center">
            <h2 className="font-brand text-headline-md font-semibold text-on-surface">
              Everything you need to run bots at scale
            </h2>
            <p className="text-body-lg text-on-surface-variant max-w-xl mx-auto">
              Built for developers and operators who want one framework for
              every major chat platform — without compromises.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex flex-col gap-4 rounded-2xl border border-outline-variant bg-surface p-6 shadow-elevation-1 transition-shadow duration-medium-1 hover:shadow-elevation-2"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
                  <f.Icon className="h-5 w-5" />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-title-md font-semibold text-on-surface">
                    {f.title}
                  </h3>
                  <p className="text-body-sm text-on-surface-variant leading-relaxed">
                    {f.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto flex flex-col items-center gap-6 text-center">
          <h2 className="font-brand text-headline-md font-semibold text-on-surface">
            Ready to deploy your first bot?
          </h2>
          <p className="text-body-lg text-on-surface-variant">
            Create your account and go from zero to a live multi-platform bot
            session in minutes.
          </p>
          {isAuthenticated ? (
            // Final nudge respects auth state
            <Button
              as={Link}
              to={ROUTES.DASHBOARD.ROOT}
              variant="filled"
              color="primary"
              size="lg"
              leftIcon={<LayoutDashboard className="h-4 w-4" />}
            >
              Go to Dashboard
            </Button>
          ) : (
            <Button
              as={Link}
              to={ROUTES.SIGNUP}
              variant="filled"
              color="primary"
              size="lg"
              leftIcon={<ArrowRight className="h-4 w-4" />}
            >
              Create Free Account
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
