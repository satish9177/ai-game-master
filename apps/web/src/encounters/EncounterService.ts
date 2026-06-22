import type { EncounterSpec } from '../domain/encounters/encounterSpec'
import { planEncounter } from '../domain/encounters/planEncounter'
import type {
  ChoiceAction,
  EncounterOutcomeResult,
  EncounterRejectionReason,
} from '../domain/encounters/planEncounter'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import { applyCommands } from '../world-session/applyCommands'
import type { WorldSession } from '../world-session/WorldSession'

/**
 * Application service for encounters (ADR-0015), a peer of InteractionService.
 * It runs the pure `planEncounter` decision through the unchanged ADR-0013
 * write path (`WorldSession.appendEvent`, via the shared `applyCommands`
 * helper) and returns a typed result. It is headless — no React, no renderer.
 *
 * Expected failures are typed results, never thrown. Logs carry only the
 * sessionId, the chosen action, command count, and result status/reason codes —
 * never description/title/label/resultText, status strings, or item names.
 */
export type EncounterSession = Pick<WorldSession, 'getWorldState' | 'appendEvent'>

export type EncounterResult =
  | { status: 'applied'; outcome: EncounterOutcomeResult; state: WorldState }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' }; state: WorldState }
  | { status: 'rejected'; reason: 'missing-encounter' | EncounterRejectionReason }
  | { status: 'failed'; reason: 'conflict' | 'not-found' | 'partial' }

export type ResolveEncounterInput = {
  sessionId: string
  encounter?: EncounterSpec
  choiceId: string
  ref: string | undefined
}

export class EncounterService {
  private readonly session: EncounterSession
  private readonly log: Logger

  constructor(session: EncounterSession, logger: Logger) {
    this.session = session
    this.log = logger
  }

  async resolve(input: ResolveEncounterInput): Promise<EncounterResult> {
    const { sessionId, encounter, choiceId, ref } = input
    if (!encounter) {
      const result = { status: 'rejected', reason: 'missing-encounter' } as const
      this.logResult(sessionId, result.status, 0, result.reason)
      return result
    }

    const current = await this.session.getWorldState(sessionId)
    if (!current.ok) {
      const result = { status: 'failed', reason: 'not-found' } as const
      this.logResult(sessionId, result.status, 0, result.reason)
      return result
    }

    const plan = planEncounter({ encounter, choiceId, ref, state: current.state })
    if (plan.status === 'already-resolved') {
      const result = { ...plan, state: current.state }
      this.logResult(sessionId, result.status, 0)
      return result
    }
    if (plan.status === 'rejected') {
      this.logResult(sessionId, plan.status, 0, plan.reason)
      return plan
    }

    const applied = await applyCommands(this.session, sessionId, plan.commands, current.state)
    if (!applied.ok) {
      this.logResult(sessionId, 'failed', plan.commands.length, applied.reason, plan.outcome.action)
      return { status: 'failed', reason: applied.reason }
    }

    const result = { status: 'applied', outcome: plan.outcome, state: applied.state } as const
    this.logResult(sessionId, result.status, plan.commands.length, undefined, plan.outcome.action)
    return result
  }

  private logResult(
    sessionId: string,
    status: EncounterResult['status'],
    commandCount: number,
    reason?: 'missing-encounter' | EncounterRejectionReason | 'conflict' | 'not-found' | 'partial',
    action?: ChoiceAction,
  ): void {
    const context = {
      sessionId,
      status,
      commandCount,
      ...(reason ? { reason } : {}),
      ...(action ? { action } : {}),
    }
    if (status === 'failed') this.log.warn('encounter resolution failed', context)
    else this.log.info('encounter resolved', context)
  }
}
