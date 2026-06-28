import type { WorldState } from '../domain/world/worldState'

const THRONE_ROOM_ID = 'throne-room'
const OFFERING_COFFER_ID = 'offering-coffer'
const OFFERING_COFFER_FLAG = 'interaction:offering-coffer'

const POST_USE_BODIES: Readonly<Record<string, string>> = {
  [OFFERING_COFFER_ID]: 'The coffer lies open and empty - the coin is gone.',
}

type AuthoredInteractionBodyState = Partial<Pick<WorldState, 'currentRoomId' | 'roomStates'>>
  | null
  | undefined

export function authoredPostUseInteractionBody(input: {
  objectId: string | undefined
  state: AuthoredInteractionBodyState
}): string | undefined {
  const { objectId, state } = input
  if (objectId !== OFFERING_COFFER_ID) return undefined
  if (state?.currentRoomId !== THRONE_ROOM_ID) return undefined
  if (state.roomStates?.[THRONE_ROOM_ID]?.flags?.[OFFERING_COFFER_FLAG] !== true) {
    return undefined
  }
  return POST_USE_BODIES[objectId]
}
