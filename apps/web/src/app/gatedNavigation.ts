import type { NavigationResult } from './NavigationService'
import { evaluateExitGate } from './exitGate'
import type { WorldStateResult } from '../world-session/WorldSession'

type NavigateDelegate = () => Promise<NavigationResult>

export async function navigateWithExitGate(input: {
  sessionId: string
  fromRoomId: string
  toRoomId: string
  demoQuestEnabled: boolean
  getWorldState: (sessionId: string) => Promise<WorldStateResult>
  navigate: NavigateDelegate
}): Promise<NavigationResult> {
  const { sessionId, fromRoomId, toRoomId, demoQuestEnabled, getWorldState, navigate } = input

  if (demoQuestEnabled) {
    const stateResult = await getWorldState(sessionId)
    if (stateResult.ok) {
      const gate = evaluateExitGate({
        fromRoomId,
        toRoomId,
        state: stateResult.state,
        demoQuestEnabled,
      })
      if (gate.gated) return { status: 'rejected', reason: 'blocked' }
    }
  }

  return navigate()
}
