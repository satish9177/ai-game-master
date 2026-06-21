import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { Logger } from '../platform/logger/Logger'

type Props = {
  /** Injected at the composition root so the boundary stays logger-agnostic. */
  logger: Logger
  children: ReactNode
}

type State = { hasError: boolean }

/**
 * Top-level React error boundary (FAILURE-MODES.md). The backstop for
 * *unexpected* render/lifecycle errors anywhere below it: it fails safe by
 * logging the detail through the injected Logger and showing the same calm
 * `.room-message` fallback the host uses elsewhere — never a white page or a raw
 * stack trace shown to the user.
 *
 * Expected failures (typed room-load results, WebGL unavailable, engine throws)
 * are handled inline by the host; this catches genuine bugs that escape them.
 *
 * Error boundaries must be class components — React has no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logs get the detail; the user only ever sees the calm message below.
    this.props.logger.error('unexpected UI error', {
      error: error.message,
      componentStack: info.componentStack ?? undefined,
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="room-message" role="alert">
          Something went wrong. Please reload the page.
        </div>
      )
    }
    return this.props.children
  }
}
