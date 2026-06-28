import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomObject } from '../roomSpec'
import { QuestSpecSchema, type ObjectiveCondition, type QuestSpec } from './questSpec'
import {
  GENERATED_OBJECTIVE_TEXT_MAX_LENGTH,
  GENERATED_OBJECTIVE_TITLE_MAX_LENGTH,
  GeneratedObjectiveSpecSchema,
  type GeneratedObjectiveConditionKind,
  type GeneratedObjectiveSpec,
} from './generatedObjectiveSpec'

export type ObjectiveAssemblyDropCode =
  | 'parse-failed'
  | 'schema-invalid'
  | 'condition-unsatisfiable'
  | 'quest-schema-invalid'

export type ObjectiveAssemblyDiagnostics = {
  objectiveValid: boolean
  objectiveDropped: boolean
  conditionKind: GeneratedObjectiveConditionKind | null
  conditionUnsatisfiable: boolean
  textSanitized: boolean
  textSanitizationCount: number
  dropCode: ObjectiveAssemblyDropCode | null
}

export type AssembleObjectiveResult = {
  spec: QuestSpec | null
  hint: string | null
  completionHint: string | null
  diagnostics: ObjectiveAssemblyDiagnostics
}

const GENERATED_OBJECTIVE_ID = 'generated-0'
const STRUCTURAL_ID_PATTERN =
  /(?:adjacent:)?gen-[0-9a-f]{8}(?::(?:generated-)?exit:(?:north|south|east|west))*(?::\d+)?/gi
const SAFE_NEARBY_ROOM_TEXT = 'a nearby room'

export function assembleObjective(rawText: string, room: LoadedRoom): AssembleObjectiveResult {
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return dropped('parse-failed', null, false)
  }

  const parsed = GeneratedObjectiveSpecSchema.safeParse(raw)
  if (!parsed.success) {
    return dropped('schema-invalid', null, false)
  }

  const proposal = parsed.data
  const condition = assembleCondition(proposal, room)
  if (condition == null) {
    return dropped('condition-unsatisfiable', proposal.condition.kind, true)
  }

  const text = sanitizeObjectiveText(proposal)
  const candidate: QuestSpec = {
    questId: `${room.id}-objective`,
    title: text.title,
    anchorRoomId: room.id,
    objectives: [
      {
        id: GENERATED_OBJECTIVE_ID,
        text: text.description,
        condition,
      },
    ],
  }

  const quest = QuestSpecSchema.safeParse(candidate)
  if (!quest.success) {
    return dropped('quest-schema-invalid', proposal.condition.kind, false, text.changed, text.count)
  }

  return {
    spec: quest.data,
    hint: text.hint,
    completionHint: text.completionHint,
    diagnostics: {
      objectiveValid: true,
      objectiveDropped: false,
      conditionKind: proposal.condition.kind,
      conditionUnsatisfiable: false,
      textSanitized: text.changed,
      textSanitizationCount: text.count,
      dropCode: null,
    },
  }
}

function assembleCondition(proposal: GeneratedObjectiveSpec, room: LoadedRoom): ObjectiveCondition | null {
  switch (proposal.condition.kind) {
    case 'interact-object': {
      const object = findObjectById(room, proposal.condition.objectId)
      if (object == null || !hasInteractionEffect(object)) return null
      return { kind: 'room-flag', roomId: room.id, flag: `interaction:${proposal.condition.objectId}` }
    }
    case 'resolve-encounter': {
      const object = findObjectById(room, proposal.condition.objectId)
      if (object == null) return null
      const flag = encounterFlag(object, proposal.condition.objectId)
      if (flag == null) return null
      return {
        kind: 'room-flag',
        roomId: room.id,
        flag,
      }
    }
    case 'visit-room': {
      if (proposal.condition.roomId !== room.id && !hasExitToRoom(room, proposal.condition.roomId)) {
        return null
      }
      return { kind: 'room-visited', roomId: proposal.condition.roomId }
    }
  }
}

function findObjectById(room: LoadedRoom, objectId: string): RoomObject | undefined {
  return room.objects.find((object) => object.id === objectId)
}

function hasInteractionEffect(object: RoomObject): boolean {
  return 'interaction' in object && object.interaction?.effect != null && object.interaction.encounter == null
}

function encounterFlag(object: RoomObject, objectId: string): string | null {
  if (!('interaction' in object) || object.interaction?.encounter == null) return null
  return `encounter:${object.interaction.encounter.id ?? objectId}`
}

function hasExitToRoom(room: LoadedRoom, roomId: string): boolean {
  return room.objects.some(
    (object) => 'interaction' in object && object.interaction?.exit?.toRoomId === roomId,
  )
}

function sanitizeObjectiveText(proposal: GeneratedObjectiveSpec): {
  title: string
  description: string
  hint: string
  completionHint: string
  changed: boolean
  count: number
} {
  const title = sanitizeDisplayField(proposal.title, GENERATED_OBJECTIVE_TITLE_MAX_LENGTH)
  const description = sanitizeDisplayField(proposal.description, GENERATED_OBJECTIVE_TEXT_MAX_LENGTH)
  const hint = sanitizeDisplayField(proposal.hint, GENERATED_OBJECTIVE_TEXT_MAX_LENGTH)
  const completionHint = sanitizeDisplayField(proposal.completionHint, GENERATED_OBJECTIVE_TEXT_MAX_LENGTH)
  const fields = [title, description, hint, completionHint]
  return {
    title: title.value,
    description: description.value,
    hint: hint.value,
    completionHint: completionHint.value,
    changed: fields.some((field) => field.changed),
    count: fields.filter((field) => field.changed).length,
  }
}

function sanitizeDisplayField(value: string, maxLength: number): { value: string; changed: boolean } {
  const structuralIdsRemoved = value.replace(STRUCTURAL_ID_PATTERN, SAFE_NEARBY_ROOM_TEXT)
  const bounded = structuralIdsRemoved.length > maxLength
    ? structuralIdsRemoved.slice(0, maxLength).trimEnd()
    : structuralIdsRemoved
  return { value: bounded, changed: bounded !== value }
}

function dropped(
  dropCode: ObjectiveAssemblyDropCode,
  conditionKind: GeneratedObjectiveConditionKind | null,
  conditionUnsatisfiable: boolean,
  textSanitized = false,
  textSanitizationCount = 0,
): AssembleObjectiveResult {
  return {
    spec: null,
    hint: null,
    completionHint: null,
    diagnostics: {
      objectiveValid: false,
      objectiveDropped: true,
      conditionKind,
      conditionUnsatisfiable,
      textSanitized,
      textSanitizationCount,
      dropCode,
    },
  }
}
