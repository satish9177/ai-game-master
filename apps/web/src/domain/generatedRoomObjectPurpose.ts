import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

type PurposePrompt = 'Read' | 'Inspect' | 'Examine'

const PURPOSE_PROMPTS = {
  book: 'Read',
  paper: 'Read',
  map: 'Read',
  chest: 'Inspect',
  crate: 'Inspect',
  barrel: 'Inspect',
  corpse: 'Inspect',
  table: 'Inspect',
  machine: 'Inspect',
  altar: 'Examine',
  statue: 'Examine',
  artifact: 'Examine',
} as const satisfies Partial<Record<RoomObject['type'], PurposePrompt>>

export type GeneratedObjectPurposeResult = {
  room: LoadedRoom
  purposesAssigned: number
}

export function assignGeneratedObjectPurpose(room: LoadedRoom): GeneratedObjectPurposeResult {
  let purposesAssigned = 0

  const objects = room.objects.map((object): RoomObject => {
    if (hasInteraction(object)) return object

    const prompt = PURPOSE_PROMPTS[object.type as keyof typeof PURPOSE_PROMPTS]
    if (prompt == null) return object

    purposesAssigned += 1
    return { ...object, interaction: { key: 'E', prompt } } as RoomObject
  })

  if (purposesAssigned === 0) return { room, purposesAssigned }
  return { room: { ...room, objects }, purposesAssigned }
}

function hasInteraction(object: RoomObject): boolean {
  return 'interaction' in object && object.interaction != null
}
