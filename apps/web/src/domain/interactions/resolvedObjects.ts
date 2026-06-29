import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomObject } from '../roomSpec'
import type { RoomState } from '../world/worldState'
import { interactionFlagKey } from './planInteraction'

export function resolvedObjectIds(
  room: LoadedRoom,
  roomState: RoomState | undefined,
): ReadonlySet<string> {
  const flags = roomState?.flags
  if (flags === undefined) return new Set()

  const resolved = new Set<string>()
  for (const object of room.objects) {
    const key = resolvedFlagKey(object)
    if (object.id !== undefined && key !== undefined && flags[key] === true) {
      resolved.add(object.id)
    }
  }
  return resolved
}

function resolvedFlagKey(object: RoomObject): string | undefined {
  if (!('interaction' in object)) return undefined

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

function assertNever(value: never): never {
  throw new Error(`unhandled interaction effect: ${String(value)}`)
}
