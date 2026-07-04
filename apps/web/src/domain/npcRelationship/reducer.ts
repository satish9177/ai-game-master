import { validateStructuredDialogueEffect } from '../structuredDialogueEffects/validate'
import type { StructuredDialogueEffect, StructuredDialogueEffectKind } from '../structuredDialogueEffects/contracts'
import type { NpcRelationshipState, RelationshipAxes } from './contracts'

/**
 * Pure, deterministic reduction of validated StructuredDialogueEffect
 * candidates into a bounded relationship projection. No I/O, no logger, no
 * clock, no randomness. Effects are the only input surface and carry no
 * free text, so this reducer has no path through which raw dialogue text
 * can influence relationship state.
 *
 * Authority: the returned state is a non-authoritative projection. It is
 * never a WorldEvent, WorldCommand, or WorldState field.
 */

// A single accepted effect may move any one axis by at most this much.
// This is a static invariant on RELATIONSHIP_EFFECT_DELTA_TABLE, checked by
// a unit test rather than at runtime (the table is a fixed literal).
export const MAX_PER_EFFECT_DELTA = 5

// No single reduction call may move any one axis by more than this,
// regardless of how many effects are accepted.
export const MAX_PER_TURN_DELTA = 3

// interactionCount is a safe provenance counter, bounded so it cannot grow
// without limit over an arbitrarily long session.
export const MAX_INTERACTION_COUNT = 1_000_000

type RelationshipAxisDelta = Record<keyof RelationshipAxes, number>

const ZERO_DELTA: RelationshipAxisDelta = { trust: 0, respect: 0, fear: 0, familiarity: 0 }

/**
 * Frozen, closed integer delta table. The only two kinds emitted by the
 * current dialogue classifier are neutral interaction signals, so both rows
 * move familiarity only; trust/respect/fear stay at baseline until a future,
 * separately approved feature makes valenced effect kinds emittable.
 */
export const RELATIONSHIP_EFFECT_DELTA_TABLE: Readonly<
  Partial<Record<StructuredDialogueEffectKind, RelationshipAxisDelta>>
> = Object.freeze({
  player_question_effect_candidate: { trust: 0, respect: 0, fear: 0, familiarity: 1 },
  npc_response_effect_candidate: { trust: 0, respect: 0, fear: 0, familiarity: 1 },
})

const AXIS_RANGES: Readonly<Record<keyof RelationshipAxes, { min: number; max: number }>> = {
  trust: { min: -100, max: 100 },
  respect: { min: -100, max: 100 },
  fear: { min: 0, max: 100 },
  familiarity: { min: 0, max: 100 },
}

const AXIS_KEYS = Object.keys(AXIS_RANGES) as (keyof RelationshipAxes)[]

export interface RelationshipReductionContext {
  worldId: string
  sessionId: string
  npcId: string
}

export interface RelationshipReductionResult {
  state: NpcRelationshipState
  appliedCount: number
  ignoredCount: number
  clampedAxes: number
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function isInteractionPair(effect: StructuredDialogueEffect): boolean {
  return (
    (effect.actor === 'player' && effect.target === 'npc') ||
    (effect.actor === 'npc' && effect.target === 'player')
  )
}

function passesScopeGate(effect: StructuredDialogueEffect, ctx: RelationshipReductionContext): boolean {
  return (
    effect.scope.worldId === ctx.worldId &&
    effect.scope.sessionId === ctx.sessionId &&
    effect.scope.npcId !== undefined &&
    effect.scope.npcId === ctx.npcId
  )
}

export function applyRelationshipEffects(
  prior: NpcRelationshipState,
  effects: readonly StructuredDialogueEffect[],
  ctx: RelationshipReductionContext,
): RelationshipReductionResult {
  const seenEffectIds = new Set<string>()
  const turnAccumulator: RelationshipAxisDelta = { ...ZERO_DELTA }
  let appliedCount = 0
  let ignoredCount = 0

  for (const rawEffect of effects) {
    const effect = validateStructuredDialogueEffect(rawEffect)

    if (effect === null) {
      ignoredCount += 1
      continue
    }

    // Defense in depth: the type already guarantees these, but a caller
    // could pass a mis-cast object, so re-check explicitly and fail closed.
    if (effect.status !== 'candidate' || effect.provenance.classifier !== 'deterministic-local') {
      ignoredCount += 1
      continue
    }

    if (!passesScopeGate(effect, ctx)) {
      ignoredCount += 1
      continue
    }

    const deltaRow = RELATIONSHIP_EFFECT_DELTA_TABLE[effect.kind]

    if (deltaRow === undefined) {
      ignoredCount += 1
      continue
    }

    if (seenEffectIds.has(effect.effectId)) {
      ignoredCount += 1
      continue
    }
    seenEffectIds.add(effect.effectId)

    // A known effect whose actor/target is not a direct player<->npc pair
    // (e.g. target: 'room' or 'none') still counts as processed for
    // idempotency, but moves no axis.
    const delta = isInteractionPair(effect) ? deltaRow : ZERO_DELTA

    turnAccumulator.trust += delta.trust
    turnAccumulator.respect += delta.respect
    turnAccumulator.fear += delta.fear
    turnAccumulator.familiarity += delta.familiarity

    appliedCount += 1
  }

  let clampedAxes = 0
  const nextAxes = { ...prior.axes }

  for (const axis of AXIS_KEYS) {
    const range = AXIS_RANGES[axis]
    const rawTurnDelta = turnAccumulator[axis]
    const clampedTurnDelta = clamp(rawTurnDelta, -MAX_PER_TURN_DELTA, MAX_PER_TURN_DELTA)
    const turnWasClamped = clampedTurnDelta !== rawTurnDelta

    const rawNextValue = prior.axes[axis] + clampedTurnDelta
    let nextValue = clamp(rawNextValue, range.min, range.max)
    const rangeWasClamped = nextValue !== rawNextValue

    // Familiarity is monotonic non-decreasing in v0: the delta table can
    // never produce a decrease today, but this guard keeps that invariant
    // explicit rather than incidental.
    if (axis === 'familiarity' && nextValue < prior.axes.familiarity) {
      nextValue = prior.axes.familiarity
    }

    if (turnWasClamped || rangeWasClamped) {
      clampedAxes += 1
    }

    nextAxes[axis] = nextValue
  }

  const nextInteractionCount = clamp(prior.interactionCount + appliedCount, 0, MAX_INTERACTION_COUNT)

  const nextState: NpcRelationshipState = {
    ...prior,
    axes: nextAxes,
    interactionCount: nextInteractionCount,
  }

  return {
    state: nextState,
    appliedCount,
    ignoredCount,
    clampedAxes,
  }
}
