import type { InteractionEffect } from '../domain/interactions/effects'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { InteractionResult } from '../interactions/InteractionService'

export type InteractionEffectTarget = {
  effect: InteractionEffect
  ref: string | undefined
}

export type InteractionEffectLookup = ReadonlyMap<string | undefined, InteractionEffectTarget>

export function buildInteractionEffectLookup(room: LoadedRoom): InteractionEffectLookup {
  const lookup = new Map<string | undefined, InteractionEffectTarget>()
  for (const object of room.objects) {
    const interaction = 'interaction' in object ? object.interaction : undefined
    if (!interaction?.effect) continue
    const ref = object.id
    if (ref === undefined) continue
    if (!lookup.has(ref)) lookup.set(ref, { effect: interaction.effect, ref })
  }
  return lookup
}

export function interactionResultMessage(result: InteractionResult): string | undefined {
  switch (result.status) {
    case 'applied':
      return appliedOutcomeMessage(result.outcome)
    case 'already-resolved':
      return 'Already searched.'
    case 'rejected':
      if (result.reason === 'missing-effect') return undefined
      if (result.reason === 'insufficient-item') return "You don't have that."
      return 'Nothing happens.'
    case 'failed':
      if (result.reason === 'partial') return 'The interaction was only partially completed.'
      if (result.reason === 'conflict') return 'The world changed. Try again.'
      return 'This interaction is unavailable.'
    default:
      return assertNever(result)
  }
}

function appliedOutcomeMessage(outcome: Extract<InteractionResult, { status: 'applied' }>['outcome']): string {
  switch (outcome.kind) {
    case 'inspected':
      return 'You inspect it.'
    case 'item-taken':
      return `You take: ${outcome.item.name} ×${outcome.item.quantity}`
    case 'item-used':
      return `You use: ${outcome.itemId} ×${outcome.quantityUsed}`
    case 'nothing':
      return 'Nothing happens.'
    default:
      return assertNever(outcome)
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled interaction result: ${String(value)}`)
}
