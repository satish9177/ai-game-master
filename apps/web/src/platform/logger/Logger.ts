/**
 * Logging abstraction (ADR-0003).
 *
 * All application logging goes through this interface. The ONLY implementation
 * permitted to call console.* is the browser console adapter (consoleLogger.ts),
 * enforced by an ESLint override for that path; everywhere else depends on this
 * interface so logging stays structured, swappable, and free of scattered
 * console calls. A server adapter can implement the same shape later without
 * touching call sites.
 *
 * Pure code (e.g. the RoomSpec loader) returns problems as data rather than
 * logging; the caller decides what to log. The domain never logs.
 *
 * Never log secrets, API keys, full prompts, or sensitive user data.
 */

/** Log severity, low to high. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Structured context attached to a log entry. Prefer primitive, serializable
 * values (ids, counts, types) — not whole objects, and never secrets/PII.
 */
export type LogContext = Record<string, unknown>

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  /**
   * Returns a logger that merges `bindings` into the context of every entry it
   * emits (e.g. a per-room logger). Per-call context takes precedence.
   */
  child(bindings: LogContext): Logger
}
