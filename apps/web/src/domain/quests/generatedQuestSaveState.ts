import { z } from 'zod'
import type { LoadedRoom } from '../loadRoomSpec'
import { RoomSpecSchema, type RoomSpec } from '../roomSpec'
import type { GeneratedStoryThreadKind } from '../generatedStoryThread'
import { GENERATED_OBJECTIVE_TEXT_MAX_LENGTH } from './generatedObjectiveSpec'
import { QuestSpecSchema, type QuestSpec } from './questSpec'

const GENERATED_STORY_THREAD_KINDS = [
  'escape',
  'investigate',
  'survive',
  'rescue',
  'recover-item',
] as const

export const GeneratedStoryThreadKindSchema = z.enum(GENERATED_STORY_THREAD_KINDS)

export const GeneratedQuestSaveStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    room: RoomSpecSchema,
    objectivesPerRoom: z.literal(true),
    questSpec: QuestSpecSchema.optional(),
    storyKind: GeneratedStoryThreadKindSchema.optional(),
    hints: z
      .object({
        hint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
        completionHint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
      })
      .strict()
      .optional(),
  })
  .strict()

export type GeneratedQuestSaveState = z.infer<typeof GeneratedQuestSaveStateSchema>

export const GeneratedQuestSaveStateVersionEnvelopeSchema = z
  .object({ schemaVersion: z.number().int() })
  .passthrough()

export type GeneratedQuestSaveInput = {
  room: LoadedRoom
  objectivesPerRoom: true
  questSpec?: QuestSpec
  storyKind?: GeneratedStoryThreadKind
  hints?: { hint: string; completionHint: string }
}

export type GeneratedQuestSaveLoadCode =
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-schema'

export type LoadGeneratedQuestSaveStateResult =
  | { ok: true; state: GeneratedQuestSaveState }
  | { ok: false; code: GeneratedQuestSaveLoadCode }

export function buildGeneratedQuestSaveState(
  input: GeneratedQuestSaveInput,
): GeneratedQuestSaveState | null {
  if (input.objectivesPerRoom !== true) return null

  const room = projectLoadedRoomToSpec(input.room)
  const candidate = {
    schemaVersion: 1,
    room,
    objectivesPerRoom: true,
    ...(input.questSpec !== undefined ? { questSpec: input.questSpec } : {}),
    ...(input.storyKind !== undefined ? { storyKind: input.storyKind } : {}),
    ...(input.hints !== undefined ? { hints: input.hints } : {}),
  }

  const parsed = GeneratedQuestSaveStateSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export function loadGeneratedQuestSaveState(json: string): LoadGeneratedQuestSaveStateResult {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(json)
  } catch {
    return { ok: false, code: 'invalid-json' }
  }

  const envelope = GeneratedQuestSaveStateVersionEnvelopeSchema.safeParse(parsedJson)
  if (!envelope.success) return { ok: false, code: 'invalid-schema' }
  if (envelope.data.schemaVersion !== 1) return { ok: false, code: 'unsupported-version' }

  const state = GeneratedQuestSaveStateSchema.safeParse(parsedJson)
  if (!state.success) return { ok: false, code: 'invalid-schema' }

  return { ok: true, state: state.data }
}

function projectLoadedRoomToSpec(room: LoadedRoom): RoomSpec {
  return {
    schemaVersion: room.schemaVersion,
    id: room.id,
    name: room.name,
    ...(room.environmentKind === undefined ? {} : { environmentKind: room.environmentKind }),
    shell: room.shell,
    spawn: room.spawn,
    lighting: room.lighting,
    objects: room.objects,
  }
}
