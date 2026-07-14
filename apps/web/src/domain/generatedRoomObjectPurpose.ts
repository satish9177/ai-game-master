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
  scroll: {
    prompt: 'Read',
    body: 'You read the scroll and mark it as reviewed.',
  },
  book: {
    prompt: 'Read',
    body: 'You read it and mark it as reviewed.',
  },
  paper: {
    prompt: 'Read',
    body: 'You read the page and mark it as reviewed.',
  },
  map: {
    prompt: 'Read',
    body: 'You study the route and mark the map as reviewed.',
  },
  chest: {
    prompt: 'Inspect',
    body: 'You open the chest and check its authored contents.',
  },
  crate: {
    prompt: 'Inspect',
    body: 'You open the crate and check its authored contents.',
  },
  barrel: {
    prompt: 'Inspect',
    body: 'You check the barrel and leave it visibly searched.',
  },
  corpse: {
    prompt: 'Inspect',
    body: 'You search the remains for clues and mark them as searched.',
  },
  table: {
    prompt: 'Inspect',
    body: 'You inspect the work surface and mark it as searched.',
  },
  machine: {
    prompt: 'Inspect',
    body: 'You inspect the mechanism and leave its indicator activated.',
  },
  altar: {
    prompt: 'Examine',
    body: 'You examine the altar and leave its markings activated.',
  },
  statue: {
    prompt: 'Examine',
    body: 'You examine the monument and mark its details as reviewed.',
  },
  artifact: {
    prompt: 'Examine',
    body: 'You examine the artifact and leave it visibly activated.',
  },
} as const satisfies Partial<Record<PurposeAssignableType, PurposeInteractionText>>

export type GeneratedObjectPurposeResult = {
  room: LoadedRoom
  purposesAssigned: number
}

export function assignGeneratedObjectPurpose(room: LoadedRoom): GeneratedObjectPurposeResult {
  let purposesAssigned = 0
  let changed = false

  const objects = room.objects.map((object, index): RoomObject => {
    const existing = interactionFor(object)
    if (isPurposeful(existing)) return object

    const text = PURPOSE_PROMPTS[object.type as keyof typeof PURPOSE_PROMPTS]
    if (text == null) {
      if (existing === undefined) return object
      if (object.type === 'npc') return object
      changed = true
      return withoutInteraction(object)
    }

    purposesAssigned += 1
    changed = true
    return {
      ...object,
      id: object.id ?? generatedInspectId(object.type, index),
      interaction: {
        ...(existing ?? {
          key: 'E',
          prompt: text.prompt,
          title: text.prompt,
          body: text.body,
        }),
        effect: { kind: 'inspect' },
      },
    } as RoomObject
  })

  if (!changed) return { room, purposesAssigned }
  return { room: { ...room, objects }, purposesAssigned }
}

function interactionFor(
  object: RoomObject,
): Extract<RoomObject, { interaction?: unknown }>['interaction'] | undefined {
  return 'interaction' in object ? object.interaction : undefined
}

function isPurposeful(
  interaction: ReturnType<typeof interactionFor>,
): boolean {
  return interaction?.effect !== undefined
    || interaction?.exit !== undefined
    || interaction?.encounter !== undefined
    || interaction?.dialogue !== undefined
}

function generatedInspectId(type: RoomObject['type'], index: number): string {
  return 'generated-inspect-' + type + '-' + index
}

function withoutInteraction(object: RoomObject): RoomObject {
  if (!('interaction' in object)) return object
  const { interaction, ...rest } = object
  return interaction === undefined ? object : rest as RoomObject
}
