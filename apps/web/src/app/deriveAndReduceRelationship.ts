import { applyRelationshipEffects } from '../domain/npcRelationship/reducer'
import type { RelationshipReductionContext } from '../domain/npcRelationship/reducer'
import type { NpcRelationshipState } from '../domain/npcRelationship/contracts'
import type { StructuredDialogueEffect } from '../domain/structuredDialogueEffects/contracts'
import type { Logger } from '../platform/logger/Logger'

export type DeriveAndReduceRelationshipInput = {
  effects: readonly StructuredDialogueEffect[]
  prior: NpcRelationshipState
  ctx: RelationshipReductionContext
  logger: Pick<Logger, 'info'>
}

export interface DeriveAndReduceRelationshipResult {
  state: NpcRelationshipState
  reducerInvoked: boolean
  appliedCount: number
  ignoredCount: number
  clampedAxes: number
}

type FamiliarityBucket = 'none' | 'low' | 'medium' | 'high'

function familiarityBucket(familiarity: number): FamiliarityBucket {
  if (familiarity <= 0) return 'none'
  if (familiarity <= 33) return 'low'
  if (familiarity <= 66) return 'medium'
  return 'high'
}

/**
 * Inert runtime seam: reduces already-validated structured dialogue effects
 * into the ephemeral, non-authoritative relationship projection for one NPC.
 * The projection is held by the caller (e.g. a React ref) and is never
 * WorldState, a WorldEvent/WorldCommand, memory, or a fact. When there are no
 * effects to reduce the pure reducer is not called at all and the prior
 * projection is returned unchanged.
 */
export function deriveAndReduceRelationship(
  input: DeriveAndReduceRelationshipInput,
): DeriveAndReduceRelationshipResult {
  if (input.effects.length === 0) {
    return {
      state: input.prior,
      reducerInvoked: false,
      appliedCount: 0,
      ignoredCount: 0,
      clampedAxes: 0,
    }
  }

  const result = applyRelationshipEffects(input.prior, input.effects, input.ctx)

  input.logger.info('npc relationship reduced', {
    processed: input.effects.length,
    applied: result.appliedCount,
    rejected: result.ignoredCount,
    clampedAxes: result.clampedAxes,
    interactionCount: result.state.interactionCount,
    familiarityBucket: familiarityBucket(result.state.axes.familiarity),
    worldId: input.ctx.worldId,
    sessionId: input.ctx.sessionId,
    npcId: input.ctx.npcId,
  })

  return {
    state: result.state,
    reducerInvoked: true,
    appliedCount: result.appliedCount,
    ignoredCount: result.ignoredCount,
    clampedAxes: result.clampedAxes,
  }
}
