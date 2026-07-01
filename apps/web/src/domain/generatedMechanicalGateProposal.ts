import { z } from 'zod'
import {
  isGeneratedGateSatisfiable,
  validateGeneratedMechanicalGate,
  type GeneratedMechanicalGate,
} from './generatedMechanicalGate'
import { interactionFlagKey } from './interactions/planInteraction'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export const GeneratedGateProposalSchema = z
  .object({
    unlockObjectId: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => !value.startsWith('interaction:') && !value.startsWith('encounter:'),
        { message: 'unlockObjectId must be a room object id, not a derived flag key' },
      ),
    exitToRoomId: z.string().trim().min(1),
  })
  .strict()

export function assembleGate(
  rawText: string,
  room: LoadedRoom,
): { gate: GeneratedMechanicalGate } | null {
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return null
  }

  const parsed = GeneratedGateProposalSchema.safeParse(raw)
  if (!parsed.success) return null

  const unlockObject = room.objects.find((object) => object.id === parsed.data.unlockObjectId)
  if (unlockObject === undefined) return null

  const flag = flagForProposedObject(unlockObject)
  if (flag === undefined) return null

  if (!hasExitToRoom(room, parsed.data.exitToRoomId)) return null

  const gate = validateGeneratedMechanicalGate({
    id: `${room.id}:mechanical-gate`,
    kind: 'locked-exit',
    condition: { kind: 'room-flag', roomId: room.id, flag },
    effect: { kind: 'unlock-exit', toRoomId: parsed.data.exitToRoomId },
  })
  if (gate === null) return null

  if (!isGeneratedGateSatisfiable(gate, room)) return null

  return { gate }
}

function flagForProposedObject(object: RoomObject): string | undefined {
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

function hasExitToRoom(room: LoadedRoom, toRoomId: string): boolean {
  return room.objects.some(
    (object) => 'interaction' in object && object.interaction?.exit?.toRoomId === toRoomId,
  )
}

function assertNever(value: never): never {
  throw new Error(`unhandled interaction effect: ${String(value)}`)
}
