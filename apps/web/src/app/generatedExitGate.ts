import {
  buildGeneratedMechanicalGate,
  evaluateGeneratedGate,
  isGeneratedGateSatisfiable,
  type GeneratedMechanicalGate,
} from '../domain/generatedMechanicalGate'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldState } from '../domain/world/worldState'
import type { ProviderGateStatus } from './generatedGate'

export type GeneratedExitGateResult = { gated: false } | { gated: true }

export function evaluateGeneratedExitGate(input: {
  room: LoadedRoom
  toRoomId: string
  state: Pick<WorldState, 'roomStates'> | null | undefined
  providerGateStatus?: ProviderGateStatus
  providerGate?: GeneratedMechanicalGate
}): GeneratedExitGateResult {
  if (input.state == null) return { gated: false }
  if (input.providerGateStatus === 'rejected') return { gated: false }

  if (input.providerGateStatus === 'accepted') {
    if (input.providerGate === undefined) return { gated: false }
    if (!isGeneratedGateSatisfiable(input.providerGate, input.room)) return { gated: false }
    return evaluateGateForExit(input.providerGate, input.toRoomId, input.state)
  }

  const gate = buildGeneratedMechanicalGate(input.room)
  if (gate === null) return { gated: false }

  return evaluateGateForExit(gate, input.toRoomId, input.state)
}

function evaluateGateForExit(
  gate: GeneratedMechanicalGate,
  toRoomId: string,
  state: Pick<WorldState, 'roomStates'>,
): GeneratedExitGateResult {
  if (gate.effect.toRoomId !== toRoomId) return { gated: false }
  return evaluateGeneratedGate(gate, state as WorldState) === 'locked'
    ? { gated: true }
    : { gated: false }
}
