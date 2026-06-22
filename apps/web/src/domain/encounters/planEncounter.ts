import { WorldCommandSchema } from '../world/events'
import type { WorldCommand } from '../world/events'
import type { WorldState } from '../world/worldState'
import type { ChoiceAction, EncounterEffectAtom, EncounterSpec } from './encounterSpec'

export type { ChoiceAction } from './encounterSpec'

/**
 * Pure domain planner for encounters (ADR-0015), a peer of `planInteraction`.
 * encounter + chosen choice + current WorldState → an ordered list of EXISTING
 * WorldCommands, or a typed non-apply outcome. Pure, total, deterministic;
 * never performs I/O, never reads Date.now/Math.random, never mutates inputs.
 *
 * It returns NO narrative text — description/label/resultText for the panel
 * come from the EncounterSpec at the composition root, keeping display strings
 * out of the domain and the logs.
 */

export type EncounterResolvedOutcome = { kind: 'resolved'; action: ChoiceAction; choiceId: string }

export type EncounterOutcomeResult =
  | EncounterResolvedOutcome
  | { kind: 'nothing' } // already-resolved / no-op

export type EncounterRejectionReason = 'missing-id' | 'unknown-choice' | 'insufficient-item'

export type EncounterPlan =
  | { status: 'apply'; commands: WorldCommand[]; outcome: EncounterResolvedOutcome }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' } }
  | { status: 'rejected'; reason: EncounterRejectionReason }

export type PlanEncounterInput = {
  encounter: EncounterSpec
  choiceId: string
  ref: string | undefined
  state: WorldState
}

export function planEncounter(input: PlanEncounterInput): EncounterPlan {
  const { encounter, choiceId, ref, state } = input

  // Stable one-shot resolution key — never generated (decision 7).
  const resolvedKey = resolveKey(encounter, ref)
  if (resolvedKey === undefined) return { status: 'rejected', reason: 'missing-id' }
  if (isFlagSet(state, resolvedKey)) {
    return { status: 'already-resolved', outcome: { kind: 'nothing' } }
  }

  const choice = encounter.choices.find((candidate) => candidate.id === choiceId)
  if (!choice) return { status: 'rejected', reason: 'unknown-choice' }

  if (choice.requires) {
    const { itemId, quantity } = choice.requires
    const held = state.inventory.find((item) => item.itemId === itemId)?.quantity ?? 0
    if (held < quantity) return { status: 'rejected', reason: 'insufficient-item' }
  }

  // Outcome effects first, the resolution flag last (mirrors `take-item`).
  const commands: WorldCommand[] = [
    ...mapAtoms(choice.outcome.effects),
    roomFlagCommand(state.currentRoomId, resolvedKey),
  ]
  return {
    status: 'apply',
    commands,
    outcome: { kind: 'resolved', action: choice.action, choiceId: choice.id },
  }
}

function mapAtoms(effects: EncounterEffectAtom[]): WorldCommand[] {
  return effects.map(mapAtom)
}

function mapAtom(atom: EncounterEffectAtom): WorldCommand {
  switch (atom.kind) {
    case 'damage':
      return WorldCommandSchema.parse({ schemaVersion: 1, type: 'health-changed', delta: -atom.amount })
    case 'heal':
      return WorldCommandSchema.parse({ schemaVersion: 1, type: 'health-changed', delta: atom.amount })
    case 'add-status':
      return WorldCommandSchema.parse({
        schemaVersion: 1,
        type: 'status-changed',
        status: atom.status,
        op: 'add',
      })
    case 'clear-status':
      return WorldCommandSchema.parse({
        schemaVersion: 1,
        type: 'status-changed',
        status: atom.status,
        op: 'clear',
      })
    case 'remove-item':
      return WorldCommandSchema.parse({
        schemaVersion: 1,
        type: 'item-removed',
        itemId: atom.itemId,
        quantity: atom.quantity,
      })
    case 'add-item':
      return WorldCommandSchema.parse({
        schemaVersion: 1,
        type: 'item-added',
        item: { ...atom.item },
      })
    default:
      return assertNever(atom)
  }
}

function resolveKey(encounter: EncounterSpec, ref: string | undefined): string | undefined {
  if (encounter.id) return `encounter:${encounter.id}`
  if (ref) return `encounter:${ref}`
  return undefined
}

function isFlagSet(state: WorldState, flagKey: string): boolean {
  return state.roomStates[state.currentRoomId]?.flags?.[flagKey] === true
}

function roomFlagCommand(roomId: string, flagKey: string): WorldCommand {
  return WorldCommandSchema.parse({
    schemaVersion: 1,
    type: 'room-state-changed',
    roomId,
    flags: { [flagKey]: true },
  })
}

function assertNever(value: never): never {
  throw new Error(`unhandled encounter effect atom: ${String(value)}`)
}
