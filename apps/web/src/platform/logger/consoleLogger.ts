import type { Logger, LogContext, LogLevel } from './Logger'

/**
 * Browser console-backed Logger (ADR-0003). This file is the single approved
 * place in the app that may call console.* — enforced by the ESLint override for
 * this path. Structured context is passed as a second console argument so
 * browser devtools render it as an inspectable object rather than a flat string.
 *
 * Every level is emitted as-is, which is behavior-equivalent to the direct
 * console calls this replaces. Environment-based level filtering (debug in dev,
 * warn+ in prod, per ADR-0003) is a later enhancement to be set by the
 * composition root when it's needed.
 */
export function createConsoleLogger(): Logger {
  return makeLogger(undefined)
}

function makeLogger(bindings: LogContext | undefined): Logger {
  return {
    debug: (message, context) => emit('debug', message, mergeContext(bindings, context)),
    info: (message, context) => emit('info', message, mergeContext(bindings, context)),
    warn: (message, context) => emit('warn', message, mergeContext(bindings, context)),
    error: (message, context) => emit('error', message, mergeContext(bindings, context)),
    child: (childBindings) => makeLogger(mergeContext(bindings, childBindings)),
  }
}

function emit(level: LogLevel, message: string, context: LogContext | undefined): void {
  // Pass context as a second argument (not concatenated) so devtools keep it
  // inspectable. Omit it entirely when absent to avoid logging a bare `undefined`.
  const args: unknown[] = context === undefined ? [message] : [message, context]
  switch (level) {
    case 'debug':
      console.debug(...args)
      break
    case 'info':
      console.info(...args)
      break
    case 'warn':
      console.warn(...args)
      break
    case 'error':
      console.error(...args)
      break
  }
}

function mergeContext(
  base: LogContext | undefined,
  extra: LogContext | undefined,
): LogContext | undefined {
  if (!base) return extra
  if (!extra) return base
  return { ...base, ...extra }
}
