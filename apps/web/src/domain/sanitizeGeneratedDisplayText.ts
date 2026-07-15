import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export type SanitizeGeneratedDisplayTextResult = {
  room: LoadedRoom
  displayTextSanitized: boolean
  displayTextSanitizationCount: number
}

type RoomInteraction = NonNullable<
  Extract<RoomObject, { interaction?: unknown }>['interaction']
>

const STRUCTURAL_ID_PATTERN =
  /(?:adjacent:)?gen-[0-9a-f]{8}(?::(?:generated-)?exit:(?:north|south|east|west))*(?::\d+)?/gi
const STRUCTURAL_ID_TEST_PATTERN =
  /(?:adjacent:)?gen-[0-9a-f]{8}(?::(?:generated-)?exit:(?:north|south|east|west))*(?::\d+)?/i

const SAFE_ROOM_NAME = 'Generated room'
const SAFE_NEARBY_ROOM_TEXT = 'a nearby room'

/** Reuse structural-id redaction for bounded generated display sidecars. */
export function redactGeneratedStructuralIds(value: string): string {
  return value.replace(STRUCTURAL_ID_PATTERN, SAFE_NEARBY_ROOM_TEXT)
}

export function sanitizeGeneratedDisplayText(
  room: LoadedRoom,
): SanitizeGeneratedDisplayTextResult {
  let displayTextSanitizationCount = 0
  let name = room.name

  if (containsStructuralId(name) && name !== SAFE_ROOM_NAME) {
    name = SAFE_ROOM_NAME
    displayTextSanitizationCount += 1
  }

  const sanitizedObjects = room.objects.map((object) => {
    const result = sanitizeObject(object)
    displayTextSanitizationCount += result.count
    return result.object
  })

  if (displayTextSanitizationCount === 0) {
    return {
      room,
      displayTextSanitized: false,
      displayTextSanitizationCount: 0,
    }
  }

  return {
    room: {
      ...room,
      name,
      objects: sanitizedObjects,
    },
    displayTextSanitized: true,
    displayTextSanitizationCount,
  }
}

function sanitizeObject(object: RoomObject): { object: RoomObject; count: number } {
  let count = 0
  let nextObject = object

  if ((object.type === 'npc' || object.type === 'zombie') && object.name != null) {
    const sanitizedName = sanitizeDisplayField(object.name)
    if (sanitizedName.changed) {
      nextObject = { ...nextObject, name: sanitizedName.value } as RoomObject
      count += 1
    }
  }

  if ('interaction' in object && object.interaction != null) {
    const sanitizedInteraction = sanitizeInteraction(object.interaction)
    if (sanitizedInteraction.count > 0) {
      nextObject = {
        ...nextObject,
        interaction: sanitizedInteraction.interaction,
      } as RoomObject
      count += sanitizedInteraction.count
    }
  }

  return { object: nextObject, count }
}

function sanitizeInteraction(
  interaction: RoomInteraction,
): { interaction: RoomInteraction; count: number } {
  let count = 0
  let nextInteraction = interaction

  const prompt = sanitizeDisplayField(interaction.prompt)
  if (prompt.changed) {
    nextInteraction = { ...nextInteraction, prompt: prompt.value }
    count += 1
  }

  if (interaction.title != null) {
    const title = sanitizeDisplayField(interaction.title)
    if (title.changed) {
      nextInteraction = { ...nextInteraction, title: title.value }
      count += 1
    }
  }

  if (interaction.body != null) {
    const body = sanitizeDisplayField(interaction.body)
    if (body.changed) {
      nextInteraction = { ...nextInteraction, body: body.value }
      count += 1
    }
  }

  if (interaction.dialogue != null) {
    const dialogue = interaction.dialogue
    let nextDialogue = dialogue

    if (dialogue.greeting != null) {
      const greeting = sanitizeDisplayField(dialogue.greeting)
      if (greeting.changed) {
        nextDialogue = { ...nextDialogue, greeting: greeting.value }
        count += 1
      }
    }

    if (dialogue.prompts != null) {
      let promptsChanged = false
      const prompts = dialogue.prompts.map((dialoguePrompt) => {
        const label = sanitizeDisplayField(dialoguePrompt.label)
        if (!label.changed) return dialoguePrompt
        promptsChanged = true
        count += 1
        return { ...dialoguePrompt, label: label.value }
      })

      if (promptsChanged) {
        nextDialogue = { ...nextDialogue, prompts }
      }
    }

    if (nextDialogue !== dialogue) {
      nextInteraction = { ...nextInteraction, dialogue: nextDialogue }
    }
  }

  return { interaction: nextInteraction, count }
}

function sanitizeDisplayField(value: string): { value: string; changed: boolean } {
  const sanitized = redactGeneratedStructuralIds(value)
  return { value: sanitized, changed: sanitized !== value }
}

function containsStructuralId(value: string): boolean {
  return STRUCTURAL_ID_TEST_PATTERN.test(value)
}
