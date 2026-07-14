import { z } from 'zod'
import type { RoomProvenance } from '../assembleRoom'
import type { GeneratedRoomVisualTheme } from '../generatedRoomThemeVocabulary'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import { RoomSpecSchema, type RoomObject, type RoomSpec } from '../roomSpec'
import { GENERATED_OBJECTIVE_TEXT_MAX_LENGTH } from './generatedObjectiveSpec'
import { QuestSpecSchema, type QuestSpec } from './questSpec'

export const GENERATED_ROOM_CACHE_MAX = 16

export const SavedGeneratedRoomObjectiveSchema = z
  .object({
    questSpec: QuestSpecSchema,
    hint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
    completionHint: z.string().min(1).max(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH),
  })
  .strict()

export type SavedGeneratedRoomObjective = z.infer<
  typeof SavedGeneratedRoomObjectiveSchema
>

export const SavedGeneratedRoomEntrySchema = z
  .object({
    room: RoomSpecSchema,
    provenance: z.enum(['generated', 'repaired', 'fallback']),
    objective: z.unknown().optional(),
  })
  .strict()

type SavedGeneratedRoomEntryParseResult = z.infer<typeof SavedGeneratedRoomEntrySchema>

export type SavedGeneratedRoomEntry = Omit<SavedGeneratedRoomEntryParseResult, 'objective'> & {
  objective?: SavedGeneratedRoomObjective
}

// Keep this closed enum in sync with GeneratedRoomVisualTheme.
export const GeneratedRoomThemePackSchema = z.enum(['fantasy-keep', 'post-apoc'])

export const GeneratedRoomCacheSaveStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    themePack: GeneratedRoomThemePackSchema.optional(),
    rooms: z.array(SavedGeneratedRoomEntrySchema).min(1).max(GENERATED_ROOM_CACHE_MAX),
  })
  .strict()

type GeneratedRoomCacheSaveStateParseResult = z.infer<
  typeof GeneratedRoomCacheSaveStateSchema
>

export type GeneratedRoomCacheSaveState = Omit<
  GeneratedRoomCacheSaveStateParseResult,
  'rooms'
> & {
  rooms: SavedGeneratedRoomEntry[]
}

export const GeneratedRoomCacheSaveStateVersionEnvelopeSchema = z
  .object({ schemaVersion: z.number().int() })
  .passthrough()

export type GeneratedRoomCacheSaveInput = {
  rooms: Array<{
    room: LoadedRoom
    provenance: RoomProvenance
    objective?: unknown
  }>
  themePack?: GeneratedRoomVisualTheme
}

export type GeneratedRoomCacheSaveLoadCode =
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-schema'

export type LoadGeneratedRoomCacheSaveStateResult =
  | { ok: true; state: GeneratedRoomCacheSaveState }
  | { ok: false; code: GeneratedRoomCacheSaveLoadCode }

export function buildGeneratedRoomCacheSaveState(
  input: GeneratedRoomCacheSaveInput,
): GeneratedRoomCacheSaveState | null {
  const seenRoomIds = new Set<string>()
  const rooms: SavedGeneratedRoomEntry[] = []

  for (const entry of input.rooms) {
    if (seenRoomIds.has(entry.room.id)) continue
    seenRoomIds.add(entry.room.id)
    const objective = parseRestorableObjective(entry.objective, entry.room)
    rooms.push({
      room: projectLoadedRoomToSpec(entry.room),
      provenance: entry.provenance,
      ...(objective !== null ? { objective } : {}),
    })
    if (rooms.length >= GENERATED_ROOM_CACHE_MAX) break
  }

  const candidate = {
    schemaVersion: 1,
    ...(input.themePack !== undefined ? { themePack: input.themePack } : {}),
    rooms,
  }

  const parsed = GeneratedRoomCacheSaveStateSchema.safeParse(candidate)
  return parsed.success ? sanitizeLoadedObjectives(parsed.data) : null
}

export function loadGeneratedRoomCacheSaveState(
  json: string,
): LoadGeneratedRoomCacheSaveStateResult {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(json)
  } catch {
    return { ok: false, code: 'invalid-json' }
  }

  const envelope = GeneratedRoomCacheSaveStateVersionEnvelopeSchema.safeParse(parsedJson)
  if (!envelope.success) return { ok: false, code: 'invalid-schema' }
  if (envelope.data.schemaVersion !== 1) return { ok: false, code: 'unsupported-version' }

  const state = GeneratedRoomCacheSaveStateSchema.safeParse(parsedJson)
  if (!state.success) return { ok: false, code: 'invalid-schema' }

  return { ok: true, state: sanitizeLoadedObjectives(state.data) }
}

export function objectiveMatchesRoom(questSpec: QuestSpec, room: LoadedRoom): boolean {
  if (questSpec.anchorRoomId !== room.id) return false
  if (questSpec.objectives.length !== 1) return false

  const objective = questSpec.objectives[0]
  if (objective == null) return false

  const condition = objective.condition
  switch (condition.kind) {
    case 'room-flag': {
      if (condition.roomId !== room.id) return false

      const interactionObjectId = parseDerivedFlagId(condition.flag, 'interaction:')
      if (interactionObjectId !== null) {
        const object = findObjectById(room, interactionObjectId)
        return object != null && hasInteractionEffect(object)
      }

      if (!condition.flag.startsWith('encounter:')) return false
      return room.objects.some((object) => encounterFlag(object) === condition.flag)
    }
    case 'room-visited':
      return condition.roomId === room.id || hasExitToRoom(room, condition.roomId)
    case 'has-item':
    case 'has-status':
      return false
  }
}

function sanitizeLoadedObjectives(
  state: GeneratedRoomCacheSaveStateParseResult,
): GeneratedRoomCacheSaveState {
  return {
    ...state,
    rooms: state.rooms.map((entry) => {
      let room: LoadedRoom
      try {
        room = loadRoomSpec(entry.room)
      } catch {
        return { room: entry.room, provenance: entry.provenance }
      }

      const objective = parseRestorableObjective(entry.objective, room)
      return {
        room: entry.room,
        provenance: entry.provenance,
        ...(objective !== null ? { objective } : {}),
      }
    }),
  }
}

function parseRestorableObjective(
  objective: unknown,
  room: LoadedRoom,
): SavedGeneratedRoomObjective | null {
  if (objective === undefined) return null
  const parsed = SavedGeneratedRoomObjectiveSchema.safeParse(objective)
  if (!parsed.success) return null
  if (!objectiveMatchesRoom(parsed.data.questSpec, room)) return null
  return parsed.data
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

function parseDerivedFlagId(flag: string, prefix: 'interaction:'): string | null {
  if (!flag.startsWith(prefix)) return null
  const id = flag.slice(prefix.length)
  return id.length > 0 ? id : null
}

function findObjectById(room: LoadedRoom, objectId: string): RoomObject | undefined {
  return room.objects.find((object) => object.id === objectId)
}

function hasInteractionEffect(object: RoomObject): boolean {
  return 'interaction' in object && object.interaction?.effect != null && object.interaction.encounter == null
}

function encounterFlag(object: RoomObject): string | null {
  if (!('interaction' in object) || object.interaction?.encounter == null) return null
  return `encounter:${object.interaction.encounter.id ?? object.id}`
}

function hasExitToRoom(room: LoadedRoom, roomId: string): boolean {
  return room.objects.some(
    (object) => 'interaction' in object && object.interaction?.exit?.toRoomId === roomId,
  )
}
