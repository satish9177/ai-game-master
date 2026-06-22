import type { InteractionEffect } from '../domain/interactions/effects'
import { planInteraction } from '../domain/interactions/planInteraction'
import type {
  InteractionOutcome,
  InteractionRejectionReason,
} from '../domain/interactions/planInteraction'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import type {
  AppendEventResult,
  WorldSession,
} from '../world-session/WorldSession'

export type InteractionSession = Pick<WorldSession, 'getWorldState' | 'appendEvent'>

export type InteractionResult =
  | { status: 'applied'; outcome: InteractionOutcome; state: WorldState }
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

    let latestState = current.state
    for (const [index, command] of plan.commands.entries()) {
      const appended = await this.session.appendEvent(
        sessionId,
        command,
        latestState.revision,
      )
      if (!appended.ok) {
        const reason = index === 0 ? mapFirstAppendFailure(appended) : 'partial'
        this.logResult(sessionId, 'failed', plan.commands.length, reason, effect.kind)
        return { status: 'failed', reason }
      }
      latestState = appended.state
    }

    const result = { status: 'applied', outcome: plan.outcome, state: latestState } as const
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

function mapFirstAppendFailure(result: Extract<AppendEventResult, { ok: false }>):
  'conflict' | 'not-found' | 'partial' {
  if (result.error.code === 'conflict') return 'conflict'
  if (result.error.code === 'not-found') return 'not-found'
  return 'partial'
}
