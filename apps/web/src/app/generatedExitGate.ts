import {
  buildGeneratedMechanicalGate,
  evaluateGeneratedGate,
} from '../domain/generatedMechanicalGate'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldState } from '../domain/world/worldState'

export type GeneratedExitGateResult = { gated: false } | { gated: true }

export function evaluateGeneratedExitGate(input: {
  room: LoadedRoom
  toRoomId: string
  state: Pick<WorldState, 'roomStates'>
}): GeneratedExitGateResult {
  const gate = buildGeneratedMechanicalGate(input.room)
  if (gate === null) return { gated: false }
  if (gate.effect.toRoomId !== input.toRoomId) return { gated: false }

  return evaluateGeneratedGate(gate, input.state as WorldState) === 'locked'
    ? { gated: true }
    : { gated: false }
}
