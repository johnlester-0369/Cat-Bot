/**
 * useBotValidation — Platform credential validation state machine.
 *
 * Abstracts two different validation transports:
 *   - Discord / Telegram / FB Messenger: REST POST → immediate valid/error response
 *   - Facebook Page: Socket.IO flow with async OTP delivery via webhook
 *
 * FB Page state progression:
 *   idle → validating → fbpage-webhook-pending (scenario 1) → fbpage-otp-pending → success
 *                     → fbpage-otp-pending    (scenario 2) ─────────────────────┘
 *
 * The socket is connected lazily on demand and disconnected after completion or reset.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { io as socketIOConnect } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { validationService } from '@/features/users/services/validation.service'
import type { PlatformCredentials } from '@/features/users/dtos/bot.dto'
import { Platforms } from '@/constants/platform.constants'

// ── Status union — discriminated on `phase` ────────────────────────────────────

export type ValidationStatus =
  | { phase: 'idle' }
  | { phase: 'validating' }
  | { phase: 'success'; info?: string }
  | { phase: 'error'; message: string }
  | {
      phase: 'fbpage-webhook-pending'
      webhookUrl: string
      verifyToken: string
      otp: string
    }
  | { phase: 'fbpage-otp-pending'; otp: string }

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBotValidation(): {
  status: ValidationStatus
  validate: (credentials: PlatformCredentials) => void
  reset: () => void
} {
  const [status, setStatus] = useState<ValidationStatus>({ phase: 'idle' })
  const socketRef = useRef<Socket | null>(null)

  // Clean up the socket on unmount so validation sockets never leak
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [])

  const reset = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setStatus({ phase: 'idle' })
  }, [])

  const validate = useCallback((credentials: PlatformCredentials) => {
    // Disconnect any lingering socket from a previous attempt
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setStatus({ phase: 'validating' })

    switch (credentials.platform) {
      case Platforms.Discord: {
        void validationService
          .validateDiscord(credentials.discordToken)
          .then((result) => {
            setStatus(
              result.valid
                ? {
                    phase: 'success',
                    info: result.botName ? `Bot: ${result.botName}` : undefined,
                  }
                : {
                    phase: 'error',
                    message: result.error ?? 'Invalid Discord bot token',
                  },
            )
          })
          .catch((err: unknown) => {
            setStatus({
              phase: 'error',
              message: err instanceof Error ? err.message : 'Validation failed',
            })
          })
        break
      }

      case Platforms.Telegram: {
        void validationService
          .validateTelegram(credentials.telegramToken)
          .then((result) => {
            setStatus(
              result.valid
                ? {
                    phase: 'success',
                    info: result.botName ? `Bot: ${result.botName}` : undefined,
                  }
                : {
                    phase: 'error',
                    message: result.error ?? 'Invalid Telegram bot token',
                  },
            )
          })
          .catch((err: unknown) => {
            setStatus({
              phase: 'error',
              message: err instanceof Error ? err.message : 'Validation failed',
            })
          })
        break
      }

      case Platforms.FacebookMessenger: {
        void validationService
          .validateFacebookMessenger(credentials.appstate)
          .then((result) => {
            setStatus(
              result.valid
                ? {
                    phase: 'success',
                    info: result.botName ? `Bot: ${result.botName}` : undefined,
                  }
                : {
                    phase: 'error',
                    message: result.error ?? 'Invalid appstate',
                  },
            )
          })
          .catch((err: unknown) => {
            setStatus({
              phase: 'error',
              message: err instanceof Error ? err.message : 'Validation failed',
            })
          })
        break
      }

      case Platforms.FacebookPage: {
        // Connect a fresh socket for this validation attempt
        const socket = socketIOConnect(window.location.origin, {
          withCredentials: true,
          transports: ['websocket', 'polling'],
        })
        socketRef.current = socket

        socket.on('connect_error', (err) => {
          setStatus({
            phase: 'error',
            message: `Connection error: ${err.message}`,
          })
          socket.disconnect()
          socketRef.current = null
        })

        socket.on(
          'validate:fbpage:status',
          (data: {
            step: string
            otp?: string
            webhookUrl?: string
            verifyToken?: string
            error?: string
          }) => {
            switch (data.step) {
              case 'webhook-pending':
                setStatus({
                  phase: 'fbpage-webhook-pending',
                  webhookUrl: data.webhookUrl ?? '',
                  verifyToken: data.verifyToken ?? '',
                  otp: data.otp ?? '',
                })
                break

              case 'webhook-verified':
                // Webhook handshake completed — advance to OTP challenge, preserving the OTP
                setStatus((prev) => {
                  if (prev.phase === 'fbpage-webhook-pending') {
                    return { phase: 'fbpage-otp-pending', otp: prev.otp }
                  }
                  return prev
                })
                break

              case 'otp-pending':
                setStatus({ phase: 'fbpage-otp-pending', otp: data.otp ?? '' })
                break

              case 'success':
                setStatus({ phase: 'success' })
                socket.disconnect()
                socketRef.current = null
                break

              case 'error':
                setStatus({
                  phase: 'error',
                  message: data.error ?? 'Validation failed',
                })
                socket.disconnect()
                socketRef.current = null
                break
            }
          },
        )

        // Emit init after binding listeners so we never miss an early response
        socket.emit('validate:fbpage:init', {
          fbAccessToken: credentials.fbAccessToken,
          pageId: credentials.fbPageId,
        })
        break
      }
    }
  }, [])

  return { status, validate, reset }
}
