import { buildEventConsequenceJournal } from '../domain/journal/eventConsequenceJournal'
import type { JournalView } from '../domain/journal/projectJournal'
import type { EventLogResult } from '../world-session/WorldSession'

/**
 * Composition seam for consequence-journal-from-events v1 (Slice 2, D1 & D2).
 *
 * Feeds the event-derived `JournalView` (built by the pure Slice-1 projector)
 * into the existing, unchanged `JournalPanel` through the App's single `journal`
 * slot. This module is the ONLY place the feature flag env var is read, keeping
 * `import.meta.env` in the app/composition layer (like `debugConfig`/`llmConfig`).
 *
 * Boundaries: read-only. It calls only the already-existing in-memory read path
 * `WorldSession.getEventLog`; it never appends events, mutates state, writes
 * memory, or logs. On the flag being OFF, a failed/not-found log read, or a
 * projection throw it returns `null`, meaning "leave the existing journal
 * behavior unchanged" (D1 fallback). No polling, no subscriptions.
 */

/**
 * The subset of env this seam reads. Typed as an index map (like `LlmRawEnv`)
 * so `import.meta.env` is assignable and the reader stays unit-testable.
 */
export type EventConsequenceJournalRawEnv = Record<string, string | undefined>

/**
 * Default-OFF feature flag (D1). ON only when the value is exactly the string
 * `"true"`; anything else (unset, `"false"`, `" TRUE "`, `"1"`) stays OFF, so
 * the shipped authored/generated journal behavior is byte-identical by default.
 */
export function readEventConsequenceJournalEnabled(
  env: EventConsequenceJournalRawEnv = import.meta.env,
): boolean {
  return env.VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS === 'true'
}

/**
 * The smallest async composition seam (D2): read a session's append-only event
 * log and project it into the existing `JournalView` shape. Returns `null` —
 * "leave the existing journal behavior unchanged" — when the flag is OFF, the
 * log read fails or is not-found, or projection throws. When OFF it does not
 * even call `getEventLog`, so the default path stays byte-identical and cost is
 * unchanged.
 */
export async function loadEventConsequenceJournal(params: {
  enabled: boolean
  sessionId: string
  getEventLog: (sessionId: string) => Promise<EventLogResult>
}): Promise<JournalView | null> {
  if (!params.enabled) return null
  try {
    const result = await params.getEventLog(params.sessionId)
    if (!result.ok) return null
    return buildEventConsequenceJournal(result.events)
  } catch {
    return null
  }
}
