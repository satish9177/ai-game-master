import type { LoadedRoom } from '../domain/loadRoomSpec'
import { parseNpcActionFlagKey } from '../domain/npcBelief/contracts'
import type { WorldState } from '../domain/world/worldState'

export type NpcActionExitGateResult =
  | { gated: false }
  | { gated: true; npcId: string }

export function evaluateNpcActionExitGate(input: {
  room: LoadedRoom
  fromRoomId: string
  toRoomId: string
  state: Pick<WorldState, 'roomStates'> | null | undefined
  npcActionEnabled: boolean
}): NpcActionExitGateResult {
  if (!input.npcActionEnabled || input.state == null || input.room.id !== input.fromRoomId) {
    return { gated: false }
  }

  const flags = input.state.roomStates[input.fromRoomId]?.flags ?? {}
  const targets = input.room.objects
    .filter((object) => object.id !== undefined
      && 'interaction' in object
      && object.interaction?.exit?.toRoomId === input.toRoomId)
    .sort((left, right) => compareText(left.id!, right.id!))
  const enabledFlags = Object.entries(flags)
    .filter((entry): entry is [string, true] => entry[1] === true)
    .sort(([left], [right]) => compareText(left, right))

  for (const object of targets) {
    for (const [key] of enabledFlags) {
      const parsed = parseNpcActionFlagKey(key)
      if (
        parsed !== null
        && parsed.action === 'bar-exit'
        && parsed.targetObjectId === object.id
      ) return { gated: true, npcId: parsed.npcId }
    }
  }
  return { gated: false }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
