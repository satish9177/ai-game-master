import type { LoadedRoom } from '../domain/loadRoomSpec'
import { npcActionBindingFor } from '../domain/npcBelief/contracts'
import type { NpcActionRefusalReason } from '../domain/npcBelief/planNpcAction'
import { planBeliefGatedNpcAction } from '../domain/npcBelief/planNpcAction'
import type { WorldEvent } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import type { WorldSession } from '../world-session/WorldSession'

export type BeliefGatedNpcActionRawEnv = Record<string, string | undefined>

export function readBeliefGatedNpcActionEnabled(
  env: BeliefGatedNpcActionRawEnv = import.meta.env,
): boolean {
  return env.VITE_BELIEF_GATED_NPC_ACTION === 'true'
}

export type NpcActionReactionResult =
  | { status: 'committed'; state: WorldState; event: WorldEvent }
  | { status: 'refused'; reason: NpcActionRefusalReason }
  | {
      status: 'failed'
      reason: 'conflict' | 'not-found' | 'invalid-command' | 'unexpected'
    }

export async function runBeliefGatedNpcActionReaction(input: {
  enabled: boolean
  sessionId: string
  room: LoadedRoom
  state: WorldState
  session: Pick<WorldSession, 'getEventLog' | 'commitNpcAction'>
  logger: Logger
}): Promise<NpcActionReactionResult | null> {
  if (!input.enabled) return null
  if (npcActionBindingFor(input.room.id) === undefined) {
    return { status: 'refused', reason: 'no-binding' }
  }

  try {
    const logResult = await input.session.getEventLog(input.sessionId)
    if (!logResult.ok) return sessionFailure(logResult.error.code)

    const plan = planBeliefGatedNpcAction({
      room: input.room,
      state: input.state,
      log: logResult.events,
    })
    if (plan.status !== 'commit') return plan

    const committed = await input.session.commitNpcAction(
      input.sessionId,
      plan.command,
      input.state.revision,
      { room: input.room },
    )
    if (!committed.ok) return sessionFailure(committed.error.code)
    return { status: 'committed', state: committed.state, event: committed.event }
  } catch {
    input.logger.error('npc action reaction failed', {
      sessionId: input.sessionId,
      reason: 'unexpected',
    })
    return { status: 'failed', reason: 'unexpected' }
  }
}

function sessionFailure(code: string): NpcActionReactionResult {
  if (code === 'conflict' || code === 'not-found') return { status: 'failed', reason: code }
  return { status: 'failed', reason: 'invalid-command' }
}
