import type { EncounterSpec } from '../domain/encounters/encounterSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { EncounterResult } from '../encounters/EncounterService'

/**
 * Pure composition-root helpers for encounters (ADR-0015), mirroring the
 * interaction-effect lookup. Kept free of the DOM so they are unit-testable.
 *
 * `buildEncounterLookup` maps an interactable object id → its EncounterSpec.
 * `encounterResultMessage` turns a typed EncounterResult into a safe display
 * line — display strings live here, never in the domain or the logs.
 */
export type EncounterTarget = {
  encounter: EncounterSpec
  ref: string | undefined
}

export type EncounterLookup = ReadonlyMap<string | undefined, EncounterTarget>

export function buildEncounterLookup(room: LoadedRoom): EncounterLookup {
  const lookup = new Map<string | undefined, EncounterTarget>()
  for (const object of room.objects) {
    const interaction = 'interaction' in object ? object.interaction : undefined
    if (!interaction?.encounter) continue
    const ref = object.id
    if (ref === undefined) continue // never key by an id-less object (decision 7)
    if (!lookup.has(ref)) lookup.set(ref, { encounter: interaction.encounter, ref })
  }
  return lookup
}

export function encounterResultMessage(result: EncounterResult): string | undefined {
  switch (result.status) {
    case 'applied':
      return appliedOutcomeMessage(result.outcome)
    case 'already-resolved':
      return 'You have already faced this.'
    case 'rejected':
      if (result.reason === 'missing-encounter') return undefined
      if (result.reason === 'insufficient-item') return "You don't have what you need."
      return 'Nothing happens.'
    case 'failed':
      if (result.reason === 'partial') return 'The moment passes only halfway.'
      if (result.reason === 'conflict') return 'The world shifts. Try again.'
      return 'This encounter is unavailable.'
    default:
      return assertNever(result)
  }
}

function appliedOutcomeMessage(outcome: Extract<EncounterResult, { status: 'applied' }>['outcome']): string {
  if (outcome.kind === 'nothing') return 'Nothing happens.'
  switch (outcome.action) {
    case 'fight':
      return 'You stand and fight.'
    case 'hide':
      return 'You stay hidden.'
    case 'run':
      return 'You break away and run.'
    case 'distract':
      return 'You create a distraction.'
    case 'negotiate':
      return 'You talk your way through.'
    default:
      return assertNever(outcome.action)
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled encounter result: ${String(value)}`)
}
