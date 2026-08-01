import type { NavigationResult } from './NavigationService'
import { evaluateExitGate } from './exitGate'
import { evaluateGeneratedExitGate } from './generatedExitGate'
import type { GeneratedMechanicalGate } from '../domain/generatedMechanicalGate'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldStateResult } from '../world-session/WorldSession'
import type { ProviderGateStatus } from './generatedGate'
import { evaluateNpcActionExitGate } from './npcActionExitGate'

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
  npcActionEnabled?: boolean
  npcActionRoom?: LoadedRoom
} & GeneratedGateOptions): Promise<NavigationResult> {
  const { sessionId, fromRoomId, toRoomId, demoQuestEnabled, getWorldState, navigate } = input
  const generatedGateEnabled = input.generatedGateEnabled === true

  let stateResult: WorldStateResult | undefined
  let stateLookupError: unknown
  let stateLookupThrew = false
  if (demoQuestEnabled || generatedGateEnabled || input.npcActionEnabled === true) {
    try {
      stateResult = await getWorldState(sessionId)
    } catch (error) {
      stateLookupThrew = true
      stateLookupError = error
    }
  }

  if (input.npcActionEnabled === true && !stateResult?.ok) {
    return { status: 'rejected', reason: 'gate-state-unavailable' }
  }
  if (stateLookupThrew) throw stateLookupError

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

  if (input.npcActionEnabled === true) {
    if (input.npcActionRoom === undefined) {
      return { status: 'rejected', reason: 'gate-state-unavailable' }
    }
    const npcActionState = (stateResult as Extract<WorldStateResult, { ok: true }>).state
    const gate = evaluateNpcActionExitGate({
      room: input.npcActionRoom,
      fromRoomId,
      toRoomId,
      state: npcActionState,
      npcActionEnabled: true,
    })
    if (gate.gated) return { status: 'rejected', reason: 'npc-barred' }
  }

  return navigate()
}
