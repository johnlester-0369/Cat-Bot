# Web Package — Architecture

## Overview

The `packages/web/` package is the management dashboard for Cat-Bot — a Vite-bundled React 19 SPA written in strict TypeScript. It exposes two independent portals sharing one browser tab: the **User Dashboard** for bot owners managing their own sessions, and the **Admin Dashboard** for system administrators with cross-user visibility. Both portals communicate with the Express server in `packages/cat-bot/src/server/` over the same origin via Vite's dev proxy, which forwards `/api/*` and `/socket.io/*` to `localhost:3000`.

The web package follows a feature-based directory structure: cross-cutting primitives live in `src/lib/`, `src/contexts/`, `src/constants/`, and `src/styles/`; domain concerns are co-located inside `src/features/{domain}/`; route-level pages live in `src/pages/`; and the design system component library lives in `src/components/ui/`.

---

## Package Layout

```
packages/web/
│
├── index.html                            — Vite HTML entry; mounts React at #root
│
├── vite.config.ts                        — Dev server proxy configuration
│                                           /api/* → http://localhost:3000 (REST + auth)
│                                           /socket.io/* → http://localhost:3000 (WebSocket upgrade)
│                                           Both forwarded same-origin so cookies are set on localhost
│                                           without cross-origin CORS complexity in development
│
├── tailwind.config.js                    — Design token extensions mapping CSS custom properties
│                                           to Tailwind utility classes; covers colors, typography,
│                                           spacing, shadows, z-index, transitions, and state-layer
│                                           opacity; all values reference CSS variables so light/dark
│                                           theme switching requires only a class toggle on <html>
│
├── tsconfig.app.json                     — Strict TypeScript config for the application source
│                                           verbatimModuleSyntax: enforces type-only imports
│                                           erasableSyntaxOnly: forbids runtime-affecting TS constructs
│                                           noUnusedLocals + noUnusedParameters: no dead code
│                                           moduleResolution: bundler (Vite handles resolution)
│                                           @/* alias resolves to ./src/*
│
├── package.json                          — React 19, react-router-dom v7, better-auth, socket.io-client,
│                                           lucide-react, ansi-to-react, @dr.pogodin/react-helmet,
│                                           Tailwind CSS v3, Vite v8
│
└── src/
    ├── main.tsx                          — Application bootstrap
    │                                       Synchronous theme init (getInitialTheme + applyTheme) runs
    │                                       before createRoot() so there is no flash of unstyled content
    │                                       Provider wrapping order (outermost → innermost):
    │                                         StrictMode → ThemeProvider → HelmetProvider →
    │                                         UserAuthProvider → SnackbarProvider → App
    │
    ├── App.tsx                           — RouterProvider wrapper; sole consumer of the router config;
    │                                       kept minimal so all routing concerns live in routes/router.tsx
    │
    ├── routes/
    │   └── router.tsx                    — createBrowserRouter definition; three sibling top-level trees
    │                                       Public tree: Layout shell → home, login (PublicRoute), signup (PublicRoute)
    │                                       Dashboard tree: UserProtectedRoute → DashboardLayout → bot pages
    │                                       Admin tree: AdminLayout (scopes AdminAuthProvider) →
    │                                         AdminPublicRoute (login) + AdminProtectedRoute → AdminSidebarLayout → pages
    │                                       All page bundles are lazy-loaded via React.lazy() + Suspense
    │                                       so the initial JS payload only includes layout shells
    │
    ├── components/
    │   ├── layout/
    │   │   └── Layout.tsx                — Public shell for marketing and auth routes (/, /login, /signup)
    │   │                                   Sticky header with logo, auth buttons, and theme toggle;
    │   │                                   responsive: horizontal nav on md+, slide-in drawer on mobile;
    │   │                                   separated from DashboardLayout so authenticated operators see
    │   │                                   only the dashboard chrome without the public nav bar
    │   │
    │   └── ui/                           — Design system component library; every component is
    │       │                               authored against the CSS custom property token system and
    │       │                               Tailwind design token extensions from tailwind.config.js
    │       │
    │       ├── buttons/
    │       │   ├── Button.tsx            — Polymorphic button supporting variant (filled, tonal, outline,
    │       │   │                           text, link), color, size, loading state, icon slots, and
    │       │   │                           full-width layout; renders as any HTML element or React Router
    │       │   │                           Link via the `as` prop (PolymorphicComponentPropsWithRef)
    │       │   ├── IconButton.tsx        — Square button for icon-only actions
    │       │   └── CloseButton.tsx       — Specialized dismiss button
    │       │
    │       ├── data-display/
    │       │   ├── Badge.tsx             — Inline label with variant, color, dot indicator, and pill shape
    │       │   ├── Card.tsx              — Compound component (Root, Header, Title, Description, Footer)
    │       │   │                           with elevation, border, interactive hover, and padding variants
    │       │   ├── DataList.tsx          — Key-value list with horizontal/vertical orientation
    │       │   ├── EmptyState.tsx        — Zero-state placeholder with icon, title, description, action
    │       │   ├── ScrollArea.tsx        — Custom scrollbar container (Root + Viewport)
    │       │   ├── Stat.tsx              — Metric display (Root, Label, ValueText)
    │       │   ├── Status.tsx            — Online/offline indicator with pulse animation
    │       │   └── Table.tsx             — Compound table (Root, Header, Body, Row, Head, Cell,
    │       │                               Loading, Empty, ScrollArea) with glass and default variants
    │       │
    │       ├── feedback/
    │       │   ├── Alert.tsx             — Inline status banner with variant, color, title, message
    │       │   ├── Progress.tsx          — Linear and circular progress indicators; Circular.fullScreen
    │       │   │                           renders a centered loader covering the full viewport
    │       │   ├── Skeleton.tsx          — Content placeholder with text-size, circular, and rounded variants
    │       │   └── Snackbar.tsx          — Toast notification with position, duration, auto-dismiss;
    │       │                               Material Design one-at-a-time constraint (new snackbar replaces old)
    │       │
    │       ├── forms/
    │       │   ├── Field.tsx             — Compound field wrapper (Root, Label, ErrorText) with
    │       │   │                           invalid and required states propagated via React context
    │       │   ├── Input.tsx             — Text input with left/right icon slots, pill shape, read-only
    │       │   ├── PasswordInput.tsx     — Input with show/hide toggle
    │       │   ├── Textarea.tsx          — Multi-line text input
    │       │   ├── Select.tsx            — Native select with option array and placeholder
    │       │   ├── Switch.tsx            — Toggle switch with checked/onChange controlled interface
    │       │   ├── Checkbox.tsx          — Checkbox input
    │       │   └── ClipboardButton.tsx   — Copy-to-clipboard button with visual feedback
    │       │
    │       ├── navigation/
    │       │   ├── Tabs.tsx              — Controlled tab bar (Root, List, Tab) with line variant;
    │       │   │                           used for bot detail page navigation (Console/Commands/Events/Settings)
    │       │   ├── Steps.tsx             — Wizard step indicator (Root, List, Item, Trigger, Indicator,
    │       │   │                           Title, Description, Separator, Content); used in create-new-bot
    │       │   └── Pagination.tsx        — Page navigation control
    │       │
    │       ├── overlay/
    │       │   └── Dialog.tsx            — Modal dialog compound component (Root, Trigger, Positioner,
    │       │                               Backdrop, Content, Header, Title, Body, Footer, CloseTrigger)
    │       │                               with size variants and closeOnEsc / closeOnOverlayClick guards
    │       │
    │       ├── layout/
    │       │   └── Divider.tsx           — Horizontal rule with optional label and spacing variants
    │       │
    │       └── typography/
    │           └── Link.tsx              — Polymorphic anchor with unstyled, default, and external variants
    │
    ├── contexts/
    │   ├── ThemeContext.tsx              — Light/dark theme state machine
    │   │                                   getInitialTheme() reads localStorage then system preference;
    │   │                                   applyTheme() toggles .dark class on <html>;
    │   │                                   saveTheme() persists selection to localStorage;
    │   │                                   consumed by every component that renders theme-sensitive UI
    │   │
    │   ├── UserAuthContext.tsx           — User portal session state
    │   │                                   Wraps authUserClient.useSession() (better-auth React hook);
    │   │                                   exposes isAuthenticated, isLoading, user, login(), logout();
    │   │                                   login() calls signIn.email then refetch() to sync React state;
    │   │                                   scoped to the entire app via main.tsx provider wrap;
    │   │                                   cookie: better-auth.session_token (set by /api/auth)
    │   │
    │   ├── AdminAuthContext.tsx          — Admin portal session state (independent from user session)
    │   │                                   Wraps authAdminClient.useSession() pointing to /api/admin-auth;
    │   │                                   cookie: ba-admin.session_token (separate from user cookie);
    │   │                                   scoped only to the Admin route subtree via AdminLayout in router.tsx
    │   │                                   so the AdminAuthProvider is never mounted for user-portal routes;
    │   │                                   signing out of admin never touches the user portal session
    │   │
    │   └── SnackbarContext.tsx           — Global toast notification state
    │                                       One snackbar at a time (Material Design convention);
    │                                       new snackbar replaces any existing one;
    │                                       exposes snackbar(), show(), success(), error(), warning(), info();
    │                                       position and duration are configurable per-call;
    │                                       SnackbarContainer renders outside the router tree to survive
    │                                       page transitions without dismissal
    │
    ├── guards/
    │   ├── UserProtectedRoute.tsx        — Redirects unauthenticated users to /login;
    │   │                                   shows Progress.Circular while session probes in-flight;
    │   │                                   passes { from } location state so login can bounce back
    │   │
    │   ├── PublicRoute.tsx               — Redirects authenticated users away from /login and /signup
    │   │                                   to /dashboard; prevents mid-session form flash
    │   │
    │   ├── AdminProtectedRoute.tsx       — Redirects to /admin if no admin session or if role != 'admin';
    │   │                                   double-checks role client-side as defence-in-depth;
    │   │                                   admin session and user session are independent — failing this
    │   │                                   guard never touches the user portal session
    │   │
    │   └── AdminPublicRoute.tsx          — Redirects already-authenticated admins from /admin (login page)
    │                                       to /admin/dashboard; mirrors PublicRoute for the admin subtree
    │
    ├── lib/
    │   ├── api-client.lib.ts             — fetch-based HTTP client singleton
    │   │                                   Singleton with baseURL: window.location.origin (same-origin);
    │   │                                   credentials: 'include' on every request so session cookies travel;
    │   │                                   AbortController timeout (default 30 s) combined with optional
    │   │                                   external AbortSignal for cancellable requests;
    │   │                                   Content-Type negotiation: FormData bypasses JSON stringify and
    │   │                                   lets the browser set multipart boundary automatically;
    │   │                                   error classification: 401 logs session expiry, 403 logs
    │   │                                   permission denial, 5xx logs server error — all throw ApiError
    │   │                                   with response.status attached for callers to branch on
    │   │
    │   ├── better-auth-client.lib.ts     — User portal auth client
    │   │                                   createAuthClient() with no explicit baseURL; Vite proxy
    │   │                                   forwards /api/* same-origin in development;
    │   │                                   exposes authUserClient.useSession(), signIn.email(),
    │   │                                   signUp.email(), signOut(), updateUser(), changePassword()
    │   │
    │   ├── better-auth-admin-client.lib.ts — Admin portal auth client
    │   │                                   basePath: /api/admin-auth; targets the independent adminAuth
    │   │                                   betterAuth instance on the server;
    │   │                                   adminClient() plugin adds authAdminClient.admin.* methods:
    │   │                                   listUsers, banUser, unbanUser, setRole;
    │   │                                   cookie ba-admin.session_token is independent from the
    │   │                                   user portal cookie and coexists with zero interference
    │   │
    │   └── socket.lib.ts                 — Socket.IO client singleton
    │                                       getSocket() creates the connection lazily on first call;
    │                                       autoConnect: false — caller controls when to connect;
    │                                       withCredentials: true so the session cookie authenticates
    │                                       the WebSocket handshake on the server;
    │                                       disconnectSocket() tears down and clears the singleton;
    │                                       consumed by DashboardLayout (connectivity monitoring),
    │                                       useBotLogs, and useBotStatus hooks
    │
    ├── features/
    │   │
    │   ├── admin/                        — Admin portal feature module
    │   │   ├── components/
    │   │   │   └── AdminSidebarLayout.tsx — Persistent sidebar shell for all protected admin pages
    │   │   │                               Fixed-width sidebar on md+; slide-in drawer on mobile;
    │   │   │                               sticky top-0 h-screen so sidebar never stretches with content;
    │   │   │                               nav items: Overview, Users, Bot Sessions, Settings;
    │   │   │                               user identity + logout anchored to bottom;
    │   │   │                               Escape key closes mobile drawer (keyboard accessibility);
    │   │   │                               handles logout by invalidating server session before navigating
    │   │   │
    │   │   ├── hooks/
    │   │   │   └── useAdminBots.ts       — Fetches all bot sessions across all users from
    │   │   │                               GET /api/v1/admin/bots; cancellation flag prevents
    │   │   │                               stale state updates on unmount
    │   │   │
    │   │   └── services/
    │   │       └── admin.service.ts      — Admin API service class
    │   │                                   getAdminBots(): cross-user session list
    │   │                                   getSystemAdmins() / addSystemAdmin() / removeSystemAdmin()
    │   │                                   stopUserSessions(): ban orchestrator (fire-and-forget)
    │   │                                   startUserSessions(): unban orchestrator (fire-and-forget)
    │   │
    │   └── users/                        — User portal feature module
    │       ├── components/
    │       │   ├── DashboardLayout.tsx   — Dashboard shell for authenticated users
    │       │   │                           Sticky top navbar: logo, Bot Manager and Settings nav links,
    │       │   │                           theme toggle, user dropdown with logout;
    │       │   │                           Mobile: hamburger → animated inline drawer below header;
    │       │   │                           Socket connectivity monitoring: persistent snackbar on
    │       │   │                           disconnect (duration: 0), auto-dismiss on reconnect;
    │       │   │                           mobile drawer collapses on route change without useEffect
    │       │   │
    │       │   ├── DashboardBotLayout.tsx — Bot detail shell for /dashboard/bot?id=<id>
    │       │   │                           Fetches bot detail via useBotDetail(id);
    │       │   │                           tabs: Console, Commands, Events, Settings;
    │       │   │                           tab navigation preserves ?id query param on every route change;
    │       │   │                           exposes BotContextType via Outlet context so child pages
    │       │   │                           share bot data without re-fetching;
    │       │   │                           useBotContext() hook is the child consumption pattern
    │       │   │
    │       │   ├── PlatformFieldInputs.tsx — Shared credential input renderer
    │       │   │                           Switches on platform prop to render the correct fields:
    │       │   │                           Discord: Token; Telegram: Token;
    │       │   │                           Facebook Page: Access Token + Page ID;
    │       │   │                           Facebook Messenger: Appstate textarea;
    │       │   │                           Used by both create-new-bot wizard and bot settings page
    │       │   │                           to prevent UI divergence between create and edit flows
    │       │   │
    │       │   └── VerificationStatusDisplay.tsx — Multi-phase credential verification UI
    │       │                               Renders different UI per ValidationStatus.phase:
    │       │                               idle → nothing; validating → pulsing text;
    │       │                               success → green checkmark with bot name;
    │       │                               error → Alert with error message;
    │       │                               fbpage-webhook-pending → webhook URL + verify token
    │       │                               form + OTP to send; fbpage-otp-pending → OTP only
    │       │
    │       ├── dtos/
    │       │   └── bot.dto.ts            — Client-side type contracts matching the server DTOs
    │       │                               PlatformCredentials: discriminated union on platform field
    │       │                               (discord / telegram / facebook-page / facebook-messenger)
    │       │                               forces exhaustive handling at compile time;
    │       │                               GetBotDetailResponseDto, BotCommandItemDto, BotEventItemDto;
    │       │                               re-exports Platform type from platform.constants.ts
    │       │
    │       ├── hooks/
    │       │   ├── useBotList.ts         — GET /api/v1/bots; cancellation-flag pattern on unmount
    │       │   ├── useBotDetail.ts       — GET /api/v1/bots/:id; exposes setBot for optimistic updates
    │       │   ├── useBotCreate.ts       — POST /api/v1/bots; navigates to bot detail on success
    │       │   ├── useBotUpdate.ts       — PUT /api/v1/bots/:id; rethrows for local form error handling
    │       │   ├── useBotCommands.ts     — GET /api/v1/bots/:id/commands;
    │       │   │                           toggleCommand(): optimistic update, reverts on API error
    │       │   ├── useBotEvents.ts       — GET /api/v1/bots/:id/events;
    │       │   │                           toggleEvent(): same optimistic pattern as useBotCommands
    │       │   ├── useBotStatus.ts       — Real-time active/offline state via Socket.IO
    │       │   │                           Emits bot:status:request with sessionId array on connect;
    │       │   │                           listens for bot:status:response (initial snapshot) and
    │       │   │                           bot:status:change (push on state flip);
    │       │   │                           stable idsKey computed via sort().join(',') to avoid
    │       │   │                           re-subscribing when the caller array reference changes
    │       │   │
    │       │   ├── useBotLogs.ts         — Real-time bot log stream via Socket.IO
    │       │   │                           Emits bot:log:subscribe with sessionKey to join the
    │       │   │                           session-scoped room; server immediately pushes
    │       │   │                           bot:log:history with the sliding window buffer so the
    │       │   │                           console is populated on page load;
    │       │   │                           bot:log:keyed carries each new log entry as it arrives;
    │       │   │                           clearLogs() emits bot:log:clear to purge the server-side
    │       │   │                           buffer before clearing local state;
    │       │   │                           capped at 200 entries to prevent unbounded memory growth
    │       │   │
    │       │   ├── useBotValidation.ts   — Platform credential validation state machine
    │       │   │                           REST path (Discord, Telegram, FB Messenger): POST to
    │       │   │                           /api/v1/validate/{platform}; immediate valid/error response;
    │       │   │                           Socket.IO path (Facebook Page): emits validate:fbpage:init;
    │       │   │                           server-driven state progression:
    │       │   │                           fbpage-webhook-pending → fbpage-otp-pending → success;
    │       │   │                           socket is created per validation attempt and disconnected
    │       │   │                           on success, error, or component unmount
    │       │   │
    │       │   └── useFbWebhook.ts       — GET /api/v1/webhooks/facebook; returns webhookUrl,
    │       │                               verifyToken, isVerified for the Facebook Page settings card
    │       │
    │       └── services/
    │           ├── bot.service.ts        — Bot lifecycle HTTP service
    │           │                           createBot, getBot, updateBot, listBots, deleteBot;
    │           │                           startBot, stopBot, restartBot (POST lifecycle endpoints);
    │           │                           getCommands, toggleCommand, getEvents, toggleEvent
    │           │
    │           ├── validation.service.ts — Credential validation REST calls
    │           │                           validateDiscord, validateTelegram, validateFacebookMessenger;
    │           │                           Facebook Page validation is Socket.IO-based in useBotValidation
    │           │
    │           └── webhook.service.ts    — getFacebookWebhookInfo(): fetches webhook URL and verify token
    │
    ├── pages/
    │   ├── Home.tsx                      — Public landing page
    │   │                                   Three sections: Hero (headline, platform badges, fake dashboard
    │   │                                   widget, CTAs), Features (four capability cards), Bottom CTA;
    │   │                                   isAuthenticated state from UserAuthContext controls whether
    │   │                                   CTAs link to /dashboard or /signup
    │   │
    │   ├── Login.tsx                     — User portal login form
    │   │                                   Client-side field validation before API call;
    │   │                                   API errors surfaced in separate banner (not field-level)
    │   │                                   to distinguish "field empty" from "credentials wrong";
    │   │                                   on success navigates to /dashboard
    │   │
    │   ├── Signup.tsx                    — User registration form
    │   │                                   Four fields: name, email, password, confirm password;
    │   │                                   on success navigates to /login (no auto-sign-in)
    │   │
    │   ├── admin/
    │   │   ├── index.tsx                 — Admin login page
    │   │   │                               Minimal restricted-access aesthetic; no sign-up links;
    │   │   │                               AdminAuthContext.login() targets /api/admin-auth;
    │   │   │                               on success navigates to /admin/dashboard
    │   │   │
    │   │   └── dashboard/
    │   │       ├── index.tsx             — Admin overview page
    │   │       │                           Stat grid: Registered Users, Active Bots, Admin Accounts,
    │   │       │                           Banned Accounts; platform distribution from useAdminBots;
    │   │       │                           Recent Registrations from authAdminClient.admin.listUsers()
    │   │       │
    │   │       ├── users.tsx             — User management table
    │   │       │                           All registered accounts with role, bot session count, join date;
    │   │       │                           ban dialog (optional reason, stops user sessions fire-and-forget);
    │   │       │                           unban dialog (restarts user sessions fire-and-forget);
    │   │       │                           client-side search filtering
    │   │       │
    │   │       ├── bots.tsx              — Bot sessions table
    │   │       │                           All sessions across all users; per-platform summary cards;
    │   │       │                           search by nickname, owner, or platform;
    │   │       │                           isRunning status badge from useAdminBots
    │   │       │
    │   │       └── settings.tsx          — Admin settings page
    │   │                                   Appearance (dark mode toggle), Admin Profile (display name,
    │   │                                   email read-only), System Administrators (global bot admin IDs
    │   │                                   persisted to DB via admin.service), Security (change password)
    │   │
    │   └── dashboard/
    │       ├── index.tsx                 — Bot Manager page
    │       │                               BotCard grid with live isActive status from useBotStatus;
    │       │                               Skeleton cards on load (no layout shift); EmptyState with
    │       │                               CTA when no bots; platform brand colours on card icons
    │       │
    │       ├── settings.tsx              — User settings page
    │       │                               Appearance, Profile (editable display name), Facebook Page
    │       │                               Webhook (URL + verify token with clipboard copy, verified status),
    │       │                               Security (change password revokes other sessions)
    │       │
    │       ├── create-new-bot.tsx        — Three-step bot creation wizard
    │       │                               Step 1 — Identity: nickname, prefix, bot admin IDs;
    │       │                               Step 2 — Platform: select platform, credential fields,
    │       │                               Verify button (must succeed before Next is enabled);
    │       │                               Step 3 — Review: read-only summary with masked credentials;
    │       │                               useBotValidation drives the multi-phase credential check
    │       │
    │       └── bot/
    │           ├── index.tsx             — Console page
    │           │                           Ansi-to-react terminal pane rendering live log stream;
    │           │                           UptimeDisplay: 1 s ticker derived from startedAt timestamp;
    │           │                           Start, Restart, Stop buttons linked to bot.service lifecycle;
    │           │                           sidebar metric cards: Status, Uptime, Platform, Prefix, Bot Admins
    │           │
    │           ├── commands.tsx          — Commands toggle page
    │           │                           Card grid per command with Switch for enable/disable;
    │           │                           optimistic toggle via useBotCommands; role badge and
    │           │                           aliases/cooldown/author metadata display
    │           │
    │           ├── events.tsx            — Event modules toggle page
    │           │                           Same card grid pattern as commands; useBotEvents
    │           │
    │           └── settings.tsx          — Bot settings page
    │                                       Bot Identity (nickname, prefix, admin IDs, premium IDs);
    │                                       Platform Credentials with PlatformFieldInputs + verification;
    │                                       credential change guard: verification required before save
    │                                       is enabled; slash platform prefix-clearing two-phase save
    │                                       prevents stale Discord/Telegram slash menus;
    │                                       Danger Zone: delete bot with confirmation dialog
    │
    ├── constants/
    │   ├── platform.constants.ts         — Platforms const object (discord, telegram, facebook-messenger,
    │   │                                   facebook-page); Platform union type; PLATFORM_LABELS display map;
    │   │                                   mirrors cat-bot engine's platform.constants.ts so both packages
    │   │                                   use identical string identifiers
    │   │
    │   └── routes.constants.ts           — ROUTES absolute paths for Link/navigate usage;
    │                                       ROUTE_SEGMENTS relative segments for createBrowserRouter
    │                                       path definitions; single source of truth so a rename is
    │                                       a one-file change with no string literals to hunt
    │
    ├── styles/
    │   ├── globals.css                   — PostCSS entry point; imports all layers in dependency order
    │   │
    │   ├── theme/
    │   │   ├── light.css                 — Light theme CSS custom properties (--light-color-* values)
    │   │   │                               Reference layer maps --color-* → --light-color-* under :root
    │   │   └── dark.css                  — Dark theme CSS custom properties (--dark-color-* values)
    │   │                                   Reference layer maps --color-* → --dark-color-* under .dark
    │   │
    │   ├── tokens.css                    — Non-color design tokens: typography scale (display through label),
    │   │                                   spacing scale, motion durations and easing curves, z-index layers,
    │   │                                   shadow elevation system, state-layer opacities
    │   │
    │   ├── base.css                      — HTML element defaults inside @layer base; body background and text;
    │   │                                   global custom scrollbar styles for all non-html elements;
    │   │                                   heading/paragraph typography defaults; selection highlight;
    │   │                                   focus-visible ring; prefers-reduced-motion override
    │   │
    │   ├── utilities.css                 — Custom utility classes inside @layer utilities:
    │   │                                   .scrollbar (explicit styled scrollbar),
    │   │                                   .scrollbar-default (reset to native OS scrollbar),
    │   │                                   .scrollbar-hidden (hide scrollbar, preserve scroll)
    │   │
    │   └── animations.css                — @keyframes library: fade-in/out, fade-in-up/down/left/right,
    │                                       slide-in-*, scale-in/out, zoom-in/out, pulse, bounce, shake,
    │                                       wobble, heartbeat, spin, ping, shimmer, skeleton, progress,
    │                                       expand, collapse; referenced by Tailwind animate-* classes
    │                                       and component-level animation shorthand strings
    │
    └── utils/
        ├── bot.util.ts                   — getPlatformLabel(platform): string → human label lookup;
        │                                   maskCredential(value): shows only last 4 chars of secrets
        │
        ├── cn.util.ts                    — cn(...classes): filters falsy values and joins class strings;
        │                                   conditional Tailwind class composition
        │
        ├── polymorphic.util.ts           — PolymorphicComponentPropsWithRef, forwardRefWithAs():
        │                                   type-safe `as` prop pattern allowing components to render
        │                                   as any HTML element or React component while preserving
        │                                   native prop types and ref forwarding
        │
        └── theme.util.ts                 — getInitialTheme(): localStorage → system preference → 'light';
                                            applyTheme(): toggles .dark on <html>;
                                            saveTheme(): localStorage persistence;
                                            toggleTheme(): light ↔ dark flip;
                                            getSystemTheme(): prefers-color-scheme query
```

---

## Routing Architecture

The router uses three sibling top-level route trees so each layout shell renders independently. Previously nesting `/dashboard` under `Layout` caused both the public navbar and the dashboard navbar to render simultaneously on dashboard routes.

```
createBrowserRouter([
│
├── { path: '/', element: <Layout /> }           ← Public shell
│   ├── index: HomePage
│   ├── { element: <PublicRoute /> }             ← Bounces authenticated users to /dashboard
│   │   ├── login: LoginPage
│   │   └── signup: SignupPage
│   └── *: NotFound
│
├── { element: <UserProtectedRoute /> }          ← Pathless guard; bounces to /login if unauthenticated
│   └── { path: '/dashboard', element: <DashboardLayout /> }
│       ├── index: BotManagerPage
│       ├── settings: SettingsPage
│       ├── create-new-bot: NewBotPage
│       └── bot: DashboardBotLayout (Outlet context: BotContextType)
│           ├── index: BotConsolePage
│           ├── commands: BotCommandsPage
│           ├── events: BotEventsPage
│           └── settings: BotSettingsPage
│
└── { element: <AdminLayout /> }                 ← Scopes AdminAuthProvider to admin subtree only
    ├── { element: <AdminPublicRoute /> }        ← Bounces authenticated admins to /admin/dashboard
    │   └── { path: '/admin', element: <AdminLoginPage /> }
    └── { element: <AdminProtectedRoute /> }     ← Bounces to /admin if no admin session or role != 'admin'
        └── { element: <AdminSidebarLayout /> }
            ├── /admin/dashboard: AdminDashboardPage
            ├── /admin/dashboard/users: AdminUsersPage
            ├── /admin/dashboard/bots: AdminBotsPage
            └── /admin/dashboard/settings: AdminSettingsPage
```

All page components are loaded via `React.lazy()` wrapped in a `Suspense` boundary with a blank surface fallback so the initial JS payload only includes layout shells and route guards.

`AdminAuthProvider` is scoped inside `AdminLayout` — a pathless wrapper component that provides the admin session context only to the admin route subtree. `App.tsx` and `main.tsx` remain completely unaware of the admin portal's session state.

---

## Authentication Architecture

Two independent better-auth client instances communicate with two independent server-side `betterAuth()` instances. The isolation is complete — different base paths, different cookie names, and different server instances.

```
User portal                              Admin portal
─────────────────────────────────────    ─────────────────────────────────────
better-auth-client.lib.ts                better-auth-admin-client.lib.ts
  basePath: (default /api/auth)            basePath: /api/admin-auth
  cookie: better-auth.session_token        cookie: ba-admin.session_token
  Plugins: (none)                          Plugins: adminClient()
  Wrapped in: UserAuthContext              Wrapped in: AdminAuthContext
  Scoped to: main.tsx (entire app)         Scoped to: AdminLayout (admin subtree only)
  Guard: UserProtectedRoute                Guard: AdminProtectedRoute
         PublicRoute                               AdminPublicRoute
```

A user who signs out of the user portal retains their admin session. A compromised user-portal cookie has zero leverage on admin endpoints. The `ba-admin.session_token` is never sent to `/api/auth/*` endpoints, and `better-auth.session_token` is never sent to `/api/admin-auth/*` endpoints.

---

## Real-Time Architecture

The web package maintains a single persistent Socket.IO connection managed by the `socket.lib.ts` singleton. The connection is established lazily when `getSocket()` is first called — typically by `DashboardLayout` on mount. Three distinct real-time concerns share this one connection.

```
socket.lib.ts singleton (one connection per browser tab)
│
├── DashboardLayout.tsx                  ← Connectivity monitoring
│   socket.on('disconnect')               Persistent snackbar on disconnect (duration: 0)
│   socket.on('connect_error')            Auto-dismisses on reconnect
│   socket.on('connect')
│
├── useBotStatus.ts                      ← Live bot active/offline state
│   emit: bot:status:request              Requests snapshot for sessionId array on connect
│   on:   bot:status:response             Initial Map<sessionId, {active, startedAt}>
│   on:   bot:status:change               Push on every session state flip
│
└── useBotLogs.ts                        ← Per-session log stream
    emit: bot:log:subscribe               Joins session-scoped room; triggers history push
    on:   bot:log:history                 Hydrates console with sliding window on subscribe
    on:   bot:log:keyed                   New log entries as they arrive
    emit: bot:log:clear                   Purges server-side buffer + clears local state
```

---

## Design System

The design system is a Material Design 3–inspired token system implemented entirely in CSS custom properties with no JavaScript dependency at the component render level. Tailwind is used only as a utility layer on top of the token system.

**Token layers (applied in globals.css import order):**

```
theme/light.css   → --light-color-* and --color-* reference layer (default)
theme/dark.css    → --dark-color-* and .dark override layer
tokens.css        → Typography, spacing, motion, z-index, shadows, state opacity
base.css          → HTML element defaults inside @layer base
utilities.css     → Scrollbar utilities inside @layer utilities
animations.css    → @keyframes library (global scope, referenced by name)
tailwind base/components/utilities directives
```

**Theme switching:** `ThemeProvider` calls `applyTheme()` which adds or removes `.dark` from `<html>`. The `.dark` CSS class triggers the override layer in `dark.css`, remapping all `--color-*` variables to their dark values. No component re-renders; all visual changes happen via CSS variable resolution.

---

## Key Design Decisions

**Feature-based directory structure over layer-based.** All code for the admin portal lives in `src/features/admin/` and all code for the user portal lives in `src/features/users/`. A developer working on admin bot session display touches only `admin/components/`, `admin/hooks/`, and `admin/services/` — no hunting across a flat `hooks/` or `services/` directory shared with unrelated features.

**Outlet context for bot detail sub-pages.** `DashboardBotLayout` fetches the bot detail once and passes it to child pages via `useOutletContext<BotContextType>()`. Each tab page (`BotConsolePage`, `BotCommandsPage`, etc.) calls `useBotContext()` to access the shared data. This prevents four parallel API calls to the same endpoint when the user navigates between tabs and keeps the bot detail as a single consistent state object.

**Optimistic toggles for command and event enable/disable.** `useBotCommands` and `useBotEvents` apply toggle state changes to local state immediately before the API call resolves. If the API call fails, the hook reverts the change. This makes the switch feel instant (no loading spinner on a PUT request) while remaining consistent with server state.

**`AdminAuthProvider` scoped to the admin route subtree.** `AdminLayout` is a pathless route component that wraps `AdminAuthProvider` around the admin subtree only. The provider is not mounted in `main.tsx` or `App.tsx`. This means `useAdminAuth()` throws immediately if called outside the admin subtree — a structural guarantee that admin session state cannot leak into user-portal components.

**`as` prop polymorphism via `forwardRefWithAs`.** `Button`, `UILink`, and other components accept an `as` prop that changes the underlying element while preserving the full native prop types. `<Button as={Link} to="/dashboard">` renders a React Router `Link` with full `href`/`to` type safety. The implementation in `polymorphic.util.ts` uses TypeScript's conditional types to merge component-specific props with the target element's native props, removing conflicts.

**Credential masking in the review step.** `maskCredential()` shows only the last 4 characters of any secret. This lets operators verify that the token they pasted ends with the expected suffix without exposing the full credential in the DOM — important when screen-sharing during setup.

**Platform constant mirroring.** `src/constants/platform.constants.ts` defines the same platform string identifiers (`discord`, `telegram`, `facebook-messenger`, `facebook-page`) as the cat-bot engine's `platform.constants.ts`. A platform rename in the engine requires updating both files — but the two files make the coupling explicit and locate it at the constant layer rather than scattered across component comparisons.