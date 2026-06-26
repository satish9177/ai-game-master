import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

type PurposePrompt = 'Read' | 'Inspect' | 'Examine'
type PurposeInteractionText = {
  prompt: PurposePrompt
  body: string
}
type InteractionCapableObject = RoomObject extends infer ObjectVariant
  ? ObjectVariant extends RoomObject
    ? 'interaction' extends keyof ObjectVariant
      ? ObjectVariant
      : never
    : never
  : never
type PurposeAssignableType = InteractionCapableObject['type']

const PURPOSE_PROMPTS = {
  book: {
    prompt: 'Read',
    body: 'You read over it carefully. Nothing changes yet.',
  },
  paper: {
    prompt: 'Read',
    body: 'You read over it carefully. Nothing changes yet.',
  },
  map: {
    prompt: 'Read',
    body: 'You read over it carefully. Nothing changes yet.',
  },
  chest: {
    prompt: 'Inspect',
    body: 'You inspect it carefully, but do not take anything.',
  },
  crate: {
    prompt: 'Inspect',
    body: 'You inspect it carefully, but do not take anything.',
  },
  barrel: {
    prompt: 'Inspect',
    body: 'You inspect it carefully, but do not take anything.',
  },
  corpse: {
    prompt: 'Inspect',
    body: 'You inspect the remains without disturbing them.',
  },
  table: {
    prompt: 'Inspect',
    body: 'You inspect it carefully, but do not take anything.',
  },
  machine: {
    prompt: 'Inspect',
    body: 'You inspect it carefully, but do not take anything.',
  },
  altar: {
    prompt: 'Examine',
    body: 'You examine it for meaning or danger. Nothing changes yet.',
  },
  statue: {
    prompt: 'Examine',
    body: 'You examine it for meaning or danger. Nothing changes yet.',
  },
  artifact: {
    prompt: 'Examine',
    body: 'You examine it for meaning or danger. Nothing changes yet.',
  },
} as const satisfies Partial<Record<PurposeAssignableType, PurposeInteractionText>>

export type GeneratedObjectPurposeResult = {
  room: LoadedRoom
  purposesAssigned: number
}

export function assignGeneratedObjectPurpose(room: LoadedRoom): GeneratedObjectPurposeResult {
  let purposesAssigned = 0

  const objects = room.objects.map((object): RoomObject => {
    if (hasInteraction(object)) return object

    const text = PURPOSE_PROMPTS[object.type as keyof typeof PURPOSE_PROMPTS]
    if (text == null) return object

    purposesAssigned += 1
    return {
      ...object,
      interaction: {
        key: 'E',
        prompt: text.prompt,
        title: text.prompt,
        body: text.body,
      },
    } as RoomObject
  })

  if (purposesAssigned === 0) return { room, purposesAssigned }
  return { room: { ...room, objects }, purposesAssigned }
}

function hasInteraction(object: RoomObject): boolean {
  return 'interaction' in object && object.interaction != null
}
