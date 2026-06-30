import { z } from 'zod'
import type { RoomProvenance } from '../assembleRoom'
import type { GeneratedRoomVisualTheme } from '../generatedRoomThemeVocabulary'
import type { LoadedRoom } from '../loadRoomSpec'
import { RoomSpecSchema, type RoomSpec } from '../roomSpec'

export const GENERATED_ROOM_CACHE_MAX = 16

export const SavedGeneratedRoomEntrySchema = z
  .object({
    room: RoomSpecSchema,
    provenance: z.enum(['generated', 'repaired', 'fallback']),
  })
  .strict()

export type SavedGeneratedRoomEntry = z.infer<typeof SavedGeneratedRoomEntrySchema>

export const GeneratedRoomThemePackSchema = z.enum(['fantasy-keep', 'post-apoc'])

export const GeneratedRoomCacheSaveStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    themePack: GeneratedRoomThemePackSchema.optional(),
    rooms: z.array(SavedGeneratedRoomEntrySchema).min(1).max(GENERATED_ROOM_CACHE_MAX),
  })
  .strict()

export type GeneratedRoomCacheSaveState = z.infer<
  typeof GeneratedRoomCacheSaveStateSchema
>

export const GeneratedRoomCacheSaveStateVersionEnvelopeSchema = z
  .object({ schemaVersion: z.number().int() })
  .passthrough()

export type GeneratedRoomCacheSaveInput = {
  rooms: Array<{ room: LoadedRoom; provenance: RoomProvenance }>
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
    rooms.push({
      room: projectLoadedRoomToSpec(entry.room),
      provenance: entry.provenance,
    })
    if (rooms.length >= GENERATED_ROOM_CACHE_MAX) break
  }

  const candidate = {
    schemaVersion: 1,
    ...(input.themePack !== undefined ? { themePack: input.themePack } : {}),
    rooms,
  }

  const parsed = GeneratedRoomCacheSaveStateSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
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

  return { ok: true, state: state.data }
}

function projectLoadedRoomToSpec(room: LoadedRoom): RoomSpec {
  return {
    schemaVersion: room.schemaVersion,
    id: room.id,
    name: room.name,
    shell: room.shell,
    spawn: room.spawn,
    lighting: room.lighting,
    objects: room.objects,
  }
}
