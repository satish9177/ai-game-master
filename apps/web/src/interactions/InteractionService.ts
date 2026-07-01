import type { InteractionEffect } from '../domain/interactions/effects'
import { planInteraction } from '../domain/interactions/planInteraction'
import type {
  InteractionOutcome,
  InteractionRejectionReason,
} from '../domain/interactions/planInteraction'
import type { WorldEvent } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import { applyCommands } from '../world-session/applyCommands'
import type { WorldSession } from '../world-session/WorldSession'

export type InteractionSession = Pick<WorldSession, 'getWorldState' | 'appendEvent'>

export type InteractionResult =
  | { status: 'applied'; outcome: InteractionOutcome; state: WorldState; events: WorldEvent[] }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' }; state: WorldState }
  | { status: 'rejected'; reason: InteractionRejectionReason }
  | { status: 'failed'; reason: 'conflict' | 'not-found' | 'partial' }

export type ResolveInteractionInput = {
  sessionId: string
  effect?: InteractionEffect
  ref: string | undefined
}

export class InteractionService {
  private readonly session: InteractionSession
  private readonly log: Logger

  constructor(session: InteractionSession, logger: Logger) {
    this.session = session
    this.log = logger
  }

  async resolve(input: ResolveInteractionInput): Promise<InteractionResult> {
    const { sessionId, effect, ref } = input
    if (!effect) {
      const result = { status: 'rejected', reason: 'missing-effect' } as const
      this.logResult(sessionId, result.status, 0, result.reason)
      return result
    }

    const current = await this.session.getWorldState(sessionId)
    if (!current.ok) {
      const result = { status: 'failed', reason: 'not-found' } as const
      this.logResult(sessionId, result.status, 0, result.reason, effect.kind)
      return result
    }

    const plan = planInteraction({ effect, ref, state: current.state })
    if (plan.status === 'already-resolved') {
      const result = { ...plan, state: current.state }
      this.logResult(sessionId, result.status, 0, undefined, effect.kind)
      return result
    }
    if (plan.status === 'rejected') {
      this.logResult(sessionId, plan.status, 0, plan.reason, effect.kind)
      return plan
    }

    const applied = await applyCommands(this.session, sessionId, plan.commands, current.state)
    if (!applied.ok) {
      this.logResult(sessionId, 'failed', plan.commands.length, applied.reason, effect.kind)
      return { status: 'failed', reason: applied.reason }
    }

    const result = {
      status: 'applied',
      outcome: plan.outcome,
      state: applied.state,
      events: applied.events,
    } as const
    this.logResult(sessionId, result.status, plan.commands.length, undefined, effect.kind)
    return result
  }

  private logResult(
    sessionId: string,
    status: InteractionResult['status'],
    commandCount: number,
    reason?: InteractionRejectionReason | 'conflict' | 'not-found' | 'partial',
    effectKind?: InteractionEffect['kind'],
  ): void {
    const context = {
      sessionId,
      status,
      commandCount,
      ...(reason ? { reason } : {}),
      ...(effectKind ? { effectKind } : {}),
    }
    if (status === 'failed') this.log.warn('interaction resolution failed', context)
    else this.log.info('interaction resolved', context)
  }
}
