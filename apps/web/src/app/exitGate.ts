import type { WorldState } from '../domain/world/worldState'

const DEMO_GATE_FROM_ROOM_ID = 'throne-room'
const DEMO_GATE_TO_ROOM_ID = 'ruined-safehouse'
const MALIK_RESOLVED_FLAG = 'encounter:malik-encounter'

export type ExitGateResult =
  | { gated: false }
  | { gated: true; reason: 'malik-unresolved' }

type ExitGateState = Partial<Pick<WorldState, 'roomStates'>> | null | undefined

export function evaluateExitGate(input: {
  fromRoomId: string
  toRoomId: string
  state: ExitGateState
  demoQuestEnabled: boolean
}): ExitGateResult {
  const { fromRoomId, toRoomId, state, demoQuestEnabled } = input

  if (!demoQuestEnabled) return { gated: false }
  if (fromRoomId !== DEMO_GATE_FROM_ROOM_ID || toRoomId !== DEMO_GATE_TO_ROOM_ID) {
    return { gated: false }
  }

  const throneRoomState = state?.roomStates?.[DEMO_GATE_FROM_ROOM_ID]
  if (!throneRoomState) return { gated: false }

  return throneRoomState.flags?.[MALIK_RESOLVED_FLAG] === true
    ? { gated: false }
    : { gated: true, reason: 'malik-unresolved' }
}
