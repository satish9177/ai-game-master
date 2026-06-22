import type { WorldEvent } from './events'

export type EventLogIssueCode =
  | 'empty-log'
  | 'missing-session-started'
  | 'multiple-session-started'
  | 'session-id-mismatch'
  | 'non-monotonic-seq'
  | 'seq-gap'

export type EventLogValidationResult = {
  ok: boolean
  issues: { code: EventLogIssueCode }[]
}

const ISSUE_ORDER: EventLogIssueCode[] = [
  'empty-log',
  'missing-session-started',
  'multiple-session-started',
  'session-id-mismatch',
  'non-monotonic-seq',
  'seq-gap',
]

export function validateEventLog(log: readonly WorldEvent[]): EventLogValidationResult {
  const codes = new Set<EventLogIssueCode>()
  if (log.length === 0) {
    codes.add('empty-log')
  } else {
    if (log[0]?.type !== 'session-started') codes.add('missing-session-started')
    if (log.filter((event) => event.type === 'session-started').length > 1) {
      codes.add('multiple-session-started')
    }

    const sessionId = log[0]!.sessionId
    if (log.some((event) => event.sessionId !== sessionId)) {
      codes.add('session-id-mismatch')
    }

    log.forEach((event, index) => {
      if (event.seq !== index + 1) codes.add('seq-gap')
      const previous = log[index - 1]
      if (previous && event.seq <= previous.seq) codes.add('non-monotonic-seq')
    })
  }

  const issues = ISSUE_ORDER.filter((code) => codes.has(code)).map((code) => ({ code }))
  return { ok: issues.length === 0, issues }
}
