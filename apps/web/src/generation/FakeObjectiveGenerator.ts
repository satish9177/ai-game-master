import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import type { RoomObject } from '../domain/roomSpec'

const GENERATED_TITLE = 'Secure the room'
const GENERATED_DESCRIPTION = 'Investigate the marked feature.'
const GENERATED_HINT = 'Look for the feature that responds to your touch.'
const GENERATED_COMPLETION_HINT = 'That was the important thing here.'

type EligibleObject = RoomObject & { id: string }

export class FakeObjectiveGenerator implements ObjectiveGenerator {
  async generate(room: LoadedRoom): Promise<string | null> {
    const eligible = room.objects.filter(isEligibleInteractObject)
    const object = eligible.find(isDedicatedObjectiveTarget)
      ?? eligible.find((candidate) => !candidate.id.startsWith('generated-inspect-'))
    if (object == null) return null

    return JSON.stringify({
      title: GENERATED_TITLE,
      description: GENERATED_DESCRIPTION,
      hint: GENERATED_HINT,
      completionHint: GENERATED_COMPLETION_HINT,
      condition: { kind: 'interact-object', objectId: object.id },
    })
  }
}

function isEligibleInteractObject(object: RoomObject): object is EligibleObject {
  return (
    object.id != null &&
    !object.id.startsWith('interaction:') &&
    !object.id.startsWith('encounter:') &&
    'interaction' in object &&
    object.interaction?.effect != null &&
    object.interaction.encounter == null
  )
}


function isDedicatedObjectiveTarget(object: EligibleObject): boolean {
  return object.id === 'objective-document'
    || object.id === 'generated-objective-target'
    || object.id.startsWith('generated-objective-target-')
}
