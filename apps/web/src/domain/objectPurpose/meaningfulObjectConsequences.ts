import { z } from 'zod'
import type { LoadedRoom } from '../loadRoomSpec'
import type { QuestSpec } from '../quests/questSpec'
import type { WorldState } from '../world/worldState'
import { isEligibleObject, meaningfulObjectFamily } from './meaningfulObjectRuntime'

const NonEmptyIdSchema = z.string().trim().min(1)

export const ClueSpecSchema = z.object({
  id: NonEmptyIdSchema,
  sourceObjectId: NonEmptyIdSchema,
}).strict()

export const MeaningfulObjectObjectiveConsequenceSchema = z.object({
  objectiveId: NonEmptyIdSchema,
  toStage: z.literal(1),
}).strict()

export const MeaningfulObjectConsequenceSpecSchema = z.object({
  objectId: NonEmptyIdSchema,
  action: z.enum(['read', 'search']),
  clueId: NonEmptyIdSchema.optional(),
  discoveryText: z.string().min(1).max(160).optional(),
  objective: MeaningfulObjectObjectiveConsequenceSchema.optional(),
}).strict().refine(
  (value) => value.clueId !== undefined || value.objective !== undefined,
  { message: 'a consequence requires a clue or objective' },
)

export const MeaningfulObjectConsequenceCatalogSchema = z.object({
  clues: z.array(ClueSpecSchema),
  consequences: z.array(MeaningfulObjectConsequenceSpecSchema),
}).strict()

export type ClueSpec = z.infer<typeof ClueSpecSchema>
export type MeaningfulObjectObjectiveConsequence = z.infer<
  typeof MeaningfulObjectObjectiveConsequenceSchema
>
export type MeaningfulObjectConsequenceSpec = z.infer<
  typeof MeaningfulObjectConsequenceSpecSchema
>
export type MeaningfulObjectConsequenceCatalog = z.infer<
  typeof MeaningfulObjectConsequenceCatalogSchema
>

export function meaningfulClueFlagKey(clueId: string): string {
  return `meaningful-clue:${encodeURIComponent(clueId)}`
}

export function meaningfulObjectiveFlagKey(questId: string, objectiveId: string): string {
  return `meaningful-objective:${encodeURIComponent(questId)}:${encodeURIComponent(objectiveId)}:stage-1`
}

export function isMeaningfulClueKnown(state: WorldState, clueId: string): boolean {
  const key = meaningfulClueFlagKey(clueId)
  return Object.values(state.roomStates).some((roomState) => roomState.flags?.[key] === true)
}

export function isMeaningfulObjectiveSatisfied(
  state: WorldState,
  questId: string,
  objectiveId: string,
  roomId: string,
): boolean {
  return state.roomStates[roomId]?.flags?.[
    meaningfulObjectiveFlagKey(questId, objectiveId)
  ] === true
}

export function parseMeaningfulObjectConsequenceCatalog(
  input: unknown,
): MeaningfulObjectConsequenceCatalog | null {
  const parsed = MeaningfulObjectConsequenceCatalogSchema.safeParse(input)
  if (!parsed.success) return null

  const attachmentKeys = new Set<string>()
  for (const consequence of parsed.data.consequences) {
    const key = `${JSON.stringify(consequence.objectId)}:${consequence.action}`
    if (attachmentKeys.has(key)) return null
    attachmentKeys.add(key)
  }

  const clueDefinitionKeys = new Set<string>()
  for (const clue of parsed.data.clues) {
    const key = JSON.stringify([clue.id, clue.sourceObjectId])
    if (clueDefinitionKeys.has(key)) return null
    clueDefinitionKeys.add(key)
  }

  for (const consequence of parsed.data.consequences) {
    if (consequence.clueId === undefined) continue
    const matches = parsed.data.clues.filter(
      (clue) => clue.id === consequence.clueId
        && clue.sourceObjectId === consequence.objectId,
    )
    if (matches.length !== 1) return null
  }

  return parsed.data
}

export function validateMeaningfulObjectConsequenceCatalog(
  input: unknown,
  context: { room: LoadedRoom; questSpec?: QuestSpec },
): MeaningfulObjectConsequenceCatalog | null {
  const catalog = parseMeaningfulObjectConsequenceCatalog(input)
  if (catalog === null) return null

  for (const consequence of catalog.consequences) {
    const matches = context.room.objects.filter((object) => object.id === consequence.objectId)
    if (matches.length !== 1) return null
    const object = matches[0]!
    if (!isEligibleObject(object)) return null
    const family = meaningfulObjectFamily(object)
    if (consequence.action === 'read' && family !== 'document') return null
    if (consequence.action === 'search' && family !== 'container' && family !== 'remains') {
      return null
    }

    if (consequence.objective !== undefined) {
      const quest = context.questSpec
      if (quest === undefined || quest.anchorRoomId !== context.room.id) return null
      if (!quest.objectives.some((objective) => objective.id === consequence.objective!.objectiveId)) {
        return null
      }
    }
  }

  return catalog
}

export function meaningfulObjectConsequenceFor(
  catalog: MeaningfulObjectConsequenceCatalog | undefined,
  objectId: string,
  action: 'read' | 'open' | 'search',
): MeaningfulObjectConsequenceSpec | undefined {
  if (catalog === undefined || action === 'open') return undefined
  const matches = catalog.consequences.filter(
    (consequence) => consequence.objectId === objectId && consequence.action === action,
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function sameRequestedMeaningfulConsequences(
  command: { clueId?: string; objective?: MeaningfulObjectObjectiveConsequence },
  attachment: MeaningfulObjectConsequenceSpec | undefined,
): boolean {
  return command.clueId === attachment?.clueId
    && command.objective?.objectiveId === attachment?.objective?.objectiveId
    && command.objective?.toStage === attachment?.objective?.toStage
    && (command.objective === undefined) === (attachment?.objective === undefined)
}
