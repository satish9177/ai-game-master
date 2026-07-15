import { z } from 'zod'
import { isGeneratedPurposeDefaultBody } from '../generatedRoomObjectPurpose'
import type { LoadedRoom } from '../loadRoomSpec'
import { redactGeneratedStructuralIds } from '../sanitizeGeneratedDisplayText'
import type { QuestSpec } from '../quests/questSpec'
import { isEligibleObject, meaningfulObjectFamily } from './meaningfulObjectRuntime'
import {
  validateMeaningfulObjectConsequenceCatalog,
  type MeaningfulObjectConsequenceCatalog,
} from './meaningfulObjectConsequences'

export const MAX_RAW_GENERATED_MEANINGFUL_CONSEQUENCES = 32
export const MAX_GENERATED_MEANINGFUL_CONSEQUENCES = 3
export const MAX_GENERATED_DISCOVERY_TEXT_CHARS = 160

const RootEnvelopeSchema = z.object({
  title: z.unknown(), description: z.unknown(), hint: z.unknown(),
  completionHint: z.unknown(), condition: z.unknown(),
  meaningfulConsequences: z.unknown().optional(),
}).strict()

const ProposalSchema = z.object({
  objectId: z.string().trim().min(1),
  action: z.enum(['read', 'search']),
  discoveryText: z.string().trim().min(1).max(MAX_GENERATED_DISCOVERY_TEXT_CHARS).optional(),
  progressCurrentObjective: z.literal(true).optional(),
}).strict()

export type GeneratedMeaningfulConsequenceProposal = z.infer<typeof ProposalSchema>
export type ParsedGeneratedObjectiveEnvelope = Readonly<{
  objectiveRaw: string
  proposals: readonly GeneratedMeaningfulConsequenceProposal[] | null
}>

export function generatedMeaningfulClueId(roomId: string, objectId: string, action: 'read' | 'search'): string {
  return `generated-clue:${encodeURIComponent(roomId)}:${encodeURIComponent(objectId)}:${action}`
}

/** Strict root keys, then independent objective and proposal branch parsing. */
export function parseGeneratedObjectiveEnvelope(rawText: string): ParsedGeneratedObjectiveEnvelope | null {
  let raw: unknown
  try { raw = JSON.parse(rawText) } catch { return null }
  const root = RootEnvelopeSchema.safeParse(raw)
  if (!root.success) return null
  const objectiveRaw = JSON.stringify({
    title: root.data.title, description: root.data.description, hint: root.data.hint,
    completionHint: root.data.completionHint, condition: root.data.condition,
  })
  return { objectiveRaw, proposals: parseProposalBranch(root.data.meaningfulConsequences) }
}

function parseProposalBranch(value: unknown): readonly GeneratedMeaningfulConsequenceProposal[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_RAW_GENERATED_MEANINGFUL_CONSEQUENCES) return null
  return value.flatMap((member) => {
    const parsed = ProposalSchema.safeParse(member)
    return parsed.success ? [parsed.data] : []
  })
}

export function normalizeGeneratedDiscoveryText(value: string): string | null {
  const normalized = redactGeneratedStructuralIds(value)
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ').trim()
  if (normalized.length === 0 || normalized.length > MAX_GENERATED_DISCOVERY_TEXT_CHARS) return null
  if (/[<>]|```/u.test(normalized)) return null
  if (/\b(?:system|developer|prompt)\s*(?:message|prompt)?\s*:/iu.test(normalized)) return null
  if (/\b(?:json\s*patch|command\s*:|function\s*\(|eval\s*\(|=>)/iu.test(normalized)) return null
  return normalized
}

export function meaningfulDiscoveryTextForObject(object: LoadedRoom['objects'][number]): string | null {
  if (!('interaction' in object) || object.interaction?.body === undefined) return null
  if (isGeneratedPurposeDefaultBody(object.interaction.body)) return null
  return normalizeGeneratedDiscoveryText(object.interaction.body)
}

export function buildGeneratedMeaningfulConsequenceCatalog(input: {
  room: LoadedRoom
  generatedPlay: boolean
  proposals: readonly GeneratedMeaningfulConsequenceProposal[] | null
  questSpec?: QuestSpec
}): MeaningfulObjectConsequenceCatalog | null {
  if (!input.generatedPlay || input.proposals === null) return null
  const duplicates = duplicateKeys(input.proposals)
  const candidates = input.proposals.flatMap((proposal) => {
    if (duplicates.has(keyOf(proposal))) return []
    const matches = input.room.objects.filter((object) => object.id === proposal.objectId)
    if (matches.length !== 1) return []
    const object = matches[0]!
    if (!isEligibleObject(object)) return []
    const family = meaningfulObjectFamily(object)
    if ((proposal.action === 'read' && family !== 'document')
      || (proposal.action === 'search' && family !== 'container' && family !== 'remains')) return []
    const discoveryText = proposal.discoveryText === undefined
      ? meaningfulDiscoveryTextForObject(object)
      : normalizeGeneratedDiscoveryText(proposal.discoveryText)
    return discoveryText === null ? [] : [{ proposal, discoveryText }]
  }).sort((left, right) => compareProposal(left.proposal, right.proposal))

  const linked = uniqueObjectiveSource(input.questSpec, input.room.id)
  const objectiveCandidate = linked === undefined ? undefined : candidates.find((candidate) =>
    candidate.proposal.progressCurrentObjective === true && candidate.proposal.objectId === linked.objectId)
  const selected = [
    ...(objectiveCandidate === undefined ? [] : [objectiveCandidate]),
    ...candidates.filter((candidate) => candidate !== objectiveCandidate),
  ].slice(0, MAX_GENERATED_MEANINGFUL_CONSEQUENCES)
    .sort((left, right) => compareProposal(left.proposal, right.proposal))
  if (selected.length === 0) return null

  const catalog = {
    clues: selected.map(({ proposal }) => ({
      id: generatedMeaningfulClueId(input.room.id, proposal.objectId, proposal.action),
      sourceObjectId: proposal.objectId,
    })),
    consequences: selected.map(({ proposal, discoveryText }) => ({
      objectId: proposal.objectId,
      action: proposal.action,
      clueId: generatedMeaningfulClueId(input.room.id, proposal.objectId, proposal.action),
      discoveryText,
      ...(objectiveCandidate?.proposal === proposal && linked !== undefined
        ? { objective: { objectiveId: linked.objectiveId, toStage: 1 as const } } : {}),
    })),
  }
  return validateMeaningfulObjectConsequenceCatalog(catalog, {
    room: input.room,
    ...(input.questSpec === undefined ? {} : { questSpec: input.questSpec }),
  })
}

function uniqueObjectiveSource(quest: QuestSpec | undefined, roomId: string): { objectId: string; objectiveId: string } | undefined {
  if (quest === undefined || quest.anchorRoomId !== roomId) return undefined
  const matches = quest.objectives.flatMap((objective) => {
    const condition = objective.condition
    if (condition.kind !== 'room-flag' || condition.roomId !== roomId || !condition.flag.startsWith('interaction:')) return []
    const objectId = condition.flag.slice('interaction:'.length)
    return objectId === '' ? [] : [{ objectId, objectiveId: objective.id }]
  })
  return matches.length === 1 ? matches[0] : undefined
}

function duplicateKeys(proposals: readonly GeneratedMeaningfulConsequenceProposal[]): Set<string> {
  const counts = new Map<string, number>()
  for (const proposal of proposals) counts.set(keyOf(proposal), (counts.get(keyOf(proposal)) ?? 0) + 1)
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key))
}

function keyOf(proposal: GeneratedMeaningfulConsequenceProposal): string {
  return `${JSON.stringify(proposal.objectId)}:${proposal.action}`
}

function compareProposal(left: GeneratedMeaningfulConsequenceProposal, right: GeneratedMeaningfulConsequenceProposal): number {
  return left.objectId.localeCompare(right.objectId) || left.action.localeCompare(right.action)
}
