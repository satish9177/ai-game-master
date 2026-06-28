import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export type GeneratedRoomObjectiveTargetResult = {
  room: LoadedRoom
  objectiveTargetEnriched: boolean
}

type InteractiveObject = Extract<RoomObject, { interaction?: unknown }>
type Interaction = NonNullable<InteractiveObject['interaction']>
type ObjectiveTargetType =
  | 'book'
  | 'paper'
  | 'map'
  | 'chest'
  | 'crate'
  | 'barrel'
  | 'corpse'
  | 'table'
  | 'machine'
  | 'altar'
  | 'statue'
  | 'artifact'

const GENERATED_OBJECTIVE_TARGET_ID = 'generated-objective-target'

const OBJECTIVE_TARGET_PRIORITY = {
  altar: 0,
  statue: 1,
  corpse: 2,
  machine: 3,
  artifact: 3,
  chest: 4,
  crate: 4,
  barrel: 4,
  table: 5,
  map: 5,
  book: 5,
  paper: 5,
} as const satisfies Record<ObjectiveTargetType, number>

export function ensureGeneratedObjectiveTarget(
  room: LoadedRoom,
): GeneratedRoomObjectiveTargetResult {
  if (room.objects.some(isObjectiveReady)) {
    return { room, objectiveTargetEnriched: false }
  }

  const targetIndex = selectTargetIndex(room.objects)
  if (targetIndex === -1) return { room, objectiveTargetEnriched: false }

  const target = room.objects[targetIndex]!
  if (!hasInteraction(target)) return { room, objectiveTargetEnriched: false }

  const id = target.id ?? nextObjectiveTargetId(room)
  const objects = room.objects.map((object, index): RoomObject => {
    if (index !== targetIndex || !hasInteraction(object)) return object
    return {
      ...object,
      id,
      interaction: {
        ...object.interaction,
        effect: { kind: 'inspect' },
      },
    } as RoomObject
  })

  return {
    room: { ...room, objects },
    objectiveTargetEnriched: true,
  }
}

function selectTargetIndex(objects: RoomObject[]): number {
  let selectedIndex = -1
  let selectedPriority = Number.POSITIVE_INFINITY

  objects.forEach((object, index) => {
    const priority = candidatePriority(object)
    if (priority == null) return
    if (priority < selectedPriority) {
      selectedIndex = index
      selectedPriority = priority
    }
  })

  return selectedIndex
}

function candidatePriority(object: RoomObject): number | null {
  if (!isObjectiveTargetType(object.type)) return null
  if (!hasInteraction(object)) return null
  if (object.interaction.effect != null) return null
  if (object.interaction.encounter != null) return null
  if (object.interaction.exit != null) return null
  return OBJECTIVE_TARGET_PRIORITY[object.type]
}

function isObjectiveReady(object: RoomObject): boolean {
  return (
    typeof object.id === 'string' &&
    object.id.trim() !== '' &&
    hasInteraction(object) &&
    object.interaction.effect != null &&
    object.interaction.encounter == null
  )
}

function isObjectiveTargetType(type: RoomObject['type']): type is ObjectiveTargetType {
  return type in OBJECTIVE_TARGET_PRIORITY
}

function hasInteraction(object: RoomObject): object is RoomObject & { interaction: Interaction } {
  return 'interaction' in object && object.interaction != null
}

function nextObjectiveTargetId(room: LoadedRoom): string {
  const ids = collectStructuralIds(room)
  if (!ids.has(GENERATED_OBJECTIVE_TARGET_ID)) return GENERATED_OBJECTIVE_TARGET_ID
  for (let index = 2; ; index += 1) {
    const candidate = `${GENERATED_OBJECTIVE_TARGET_ID}-${index}`
    if (!ids.has(candidate)) return candidate
  }
}

function collectStructuralIds(room: LoadedRoom): Set<string> {
  const ids = new Set(room.objects.map((object) => object.id).filter((id): id is string => id != null))
  for (const skipped of room.skipped) {
    const id = rawStructuralId(skipped.raw)
    if (id != null) ids.add(id)
  }
  return ids
}

function rawStructuralId(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null
  const id = (raw as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}
