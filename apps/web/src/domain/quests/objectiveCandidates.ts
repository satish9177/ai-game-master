import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomObject } from '../roomSpec'

export type InteractObjectiveCandidate = {
  objectId: string
  type: RoomObject['type']
}

export function listInteractObjectiveCandidates(room: LoadedRoom): InteractObjectiveCandidate[] {
  return room.objects.flatMap((object) => {
    if (!isInteractObjectiveCandidate(object)) return []
    return [{ objectId: object.id, type: object.type }]
  })
}

function isInteractObjectiveCandidate(
  object: RoomObject,
): object is RoomObject & { id: string } {
  return (
    typeof object.id === 'string' &&
    object.id.trim() !== '' &&
    !/^(?:interaction|encounter):/.test(object.id) &&
    'interaction' in object &&
    object.interaction?.effect != null &&
    object.interaction.encounter == null
  )
}
