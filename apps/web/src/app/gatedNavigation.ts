import type { NavigationResult } from './NavigationService'
import { evaluateExitGate } from './exitGate'
import { evaluateGeneratedExitGate } from './generatedExitGate'
import type { GeneratedMechanicalGate } from '../domain/generatedMechanicalGate'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldStateResult } from '../world-session/WorldSession'
import type { ProviderGateStatus } from './generatedGate'

type NavigateDelegate = () => Promise<NavigationResult>
type GeneratedGateOptions =
  | { generatedGateEnabled?: false; currentRoom?: never }
  | {
      generatedGateEnabled: true
      currentRoom: LoadedRoom
      providerGateStatus?: ProviderGateStatus
      providerGate?: GeneratedMechanicalGate
    }

export async function navigateWithExitGate(input: {
  sessionId: string
  fromRoomId: string
  toRoomId: string
  demoQuestEnabled: boolean
  getWorldState: (sessionId: string) => Promise<WorldStateResult>
  navigate: NavigateDelegate
} & GeneratedGateOptions): Promise<NavigationResult> {
  const { sessionId, fromRoomId, toRoomId, demoQuestEnabled, getWorldState, navigate } = input
  const generatedGateEnabled = input.generatedGateEnabled === true

  let stateResult: WorldStateResult | undefined
  if (demoQuestEnabled || generatedGateEnabled) {
    stateResult = await getWorldState(sessionId)
  }

  if (demoQuestEnabled && stateResult?.ok) {
    const gate = evaluateExitGate({
      fromRoomId,
      toRoomId,
      state: stateResult.state,
      demoQuestEnabled,
    })
    if (gate.gated) return { status: 'rejected', reason: 'blocked' }
  }

  if (generatedGateEnabled && stateResult?.ok) {
    const gate = evaluateGeneratedExitGate({
      room: input.currentRoom,
      toRoomId,
      state: stateResult.state,
      providerGateStatus: input.providerGateStatus,
      providerGate: input.providerGate,
    })
    if (gate.gated) return { status: 'rejected', reason: 'gate-locked' }
  }

  return navigate()
}
