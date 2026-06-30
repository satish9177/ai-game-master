import { z } from 'zod'
import { interactionFlagKey } from './interactions/planInteraction'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import { evaluateCondition } from './quests/evaluateQuest'
import type { ObjectiveCondition } from './quests/questSpec'
import type { WorldState } from './world/worldState'

export type GeneratedGateKind = 'locked-exit'
export type GeneratedGateConditionKind = 'room-flag'
export type GeneratedGateCondition = Extract<ObjectiveCondition, { kind: 'room-flag' }>
export type GeneratedGateEffect = { kind: 'unlock-exit'; toRoomId: string }
export type GeneratedMechanicalGate = {
  id: string
  kind: GeneratedGateKind
  condition: GeneratedGateCondition
  effect: GeneratedGateEffect
}
export type GeneratedGateState = 'locked' | 'unlocked'

const GeneratedGateConditionSchema = z
  .object({
    kind: z.literal('room-flag'),
    roomId: z.string().min(1),
    flag: z.string().min(1),
  })
  .strict()

const GeneratedGateEffectSchema = z
  .object({
    kind: z.literal('unlock-exit'),
    toRoomId: z.string().min(1),
  })
  .strict()

const GeneratedMechanicalGateSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('locked-exit'),
    condition: GeneratedGateConditionSchema,
    effect: GeneratedGateEffectSchema,
  })
  .strict()

export function validateGeneratedMechanicalGate(raw: unknown): GeneratedMechanicalGate | null {
  const parsed = GeneratedMechanicalGateSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function evaluateGeneratedGate(
  gate: GeneratedMechanicalGate,
  state: WorldState,
): GeneratedGateState {
  return evaluateCondition(gate.condition, state) ? 'unlocked' : 'locked'
}

export function isGeneratedGateSatisfiable(
  gate: GeneratedMechanicalGate,
  room: LoadedRoom,
): boolean {
  if (gate.condition.roomId !== room.id) return false

  return hasReachableUnlockFlag(gate, room) && hasExitToRoom(gate.effect.toRoomId, room)
}

function hasReachableUnlockFlag(gate: GeneratedMechanicalGate, room: LoadedRoom): boolean {
  return room.objects.some((object) => flagWrittenByObject(object) === gate.condition.flag)
}

function flagWrittenByObject(object: RoomObject): string | undefined {
  if (!('interaction' in object)) return undefined
  if (object.interaction?.encounter !== undefined) return undefined

  const effect = object.interaction?.effect
  if (effect === undefined) return undefined

  switch (effect.kind) {
    case 'inspect':
      return interactionFlagKey(effect.flag, object.id)
    case 'take-item':
      return interactionFlagKey(undefined, object.id)
    case 'use-item':
      return undefined
    default:
      return assertNever(effect)
  }
}

function hasExitToRoom(toRoomId: string, room: LoadedRoom): boolean {
  return room.objects.some(
    (object) => 'interaction' in object && object.interaction?.exit?.toRoomId === toRoomId,
  )
}

function assertNever(value: never): never {
  throw new Error(`unhandled interaction effect: ${String(value)}`)
}
