import type { WorldCommand, WorldEvent } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'
import type { AppendEventResult, WorldSession } from './WorldSession'

/**
 * Shared revision-threading apply loop for application services that turn a
 * planned list of WorldCommands into appended events (ADR-0015 decision 1).
 *
 * Both InteractionService and EncounterService funnel their commands through
 * this single helper so the ADR-0013 write path ("append a typed, validated
 * event, then project") is exercised one tested way. It lives in world-session/
 * because both callers already depend on world-session and the domain — no new
 * cross-layer dependency.
 *
 * Each command is appended in order, threading the revision returned by the
 * previous append (single-writer atomicity, ADR-0014). On the FIRST command a
 * failure is mapped from the append error code; a LATER failure is `partial`.
 * It never retries.
 */
export type ApplyCommandsResult =
  | { ok: true; state: WorldState; events: WorldEvent[] }
  | { ok: false; reason: 'conflict' | 'not-found' | 'partial' }

export async function applyCommands(
  session: Pick<WorldSession, 'appendEvent'>,
  sessionId: string,
  commands: WorldCommand[],
  fromState: WorldState,
): Promise<ApplyCommandsResult> {
  let revision = fromState.revision
  let latest = fromState
  const events: WorldEvent[] = []
  for (const [index, command] of commands.entries()) {
    const appended = await session.appendEvent(sessionId, command, revision)
    if (!appended.ok) {
      const reason = index === 0 ? mapFirstAppendFailure(appended) : 'partial'
      return { ok: false, reason }
    }
    revision = appended.state.revision
    latest = appended.state
    events.push(appended.event)
  }
  return { ok: true, state: latest, events }
}

function mapFirstAppendFailure(
  result: Extract<AppendEventResult, { ok: false }>,
): 'conflict' | 'not-found' | 'partial' {
  if (result.error.code === 'conflict') return 'conflict'
  if (result.error.code === 'not-found') return 'not-found'
  return 'partial'
}
