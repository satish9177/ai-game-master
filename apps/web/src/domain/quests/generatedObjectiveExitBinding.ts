import { z } from 'zod'
import type { RoomProvenance } from '../assembleRoom'
import {
  isGeneratedGateSatisfiable,
  type GeneratedMechanicalGate,
} from '../generatedMechanicalGate'
import { isReturnExitObject, parseGeneratedExitTargetId } from '../generatedReturnExit'
import type { LoadedRoom } from '../loadRoomSpec'
import {
  deriveMeaningfulObjectState,
  meaningfulObjectFamily,
} from '../objectPurpose/meaningfulObjectRuntime'
import {
  validateMeaningfulObjectConsequenceCatalog,
  type MeaningfulObjectConsequenceCatalog,
  type MeaningfulObjectConsequenceSpec,
} from '../objectPurpose/meaningfulObjectConsequences'
import type { RoomObject } from '../roomSpec'
import type { WorldState } from '../world/worldState'
import { evaluateQuest } from './evaluateQuest'
import { QuestSpecSchema, type QuestSpec } from './questSpec'

export type GeneratedObjectiveExitBinding = Readonly<{
  objectiveId: string
  exitId: string
}>

export type GeneratedObjectiveExitBindings =
  ReadonlyMap<string, GeneratedObjectiveExitBinding>

export type GeneratedObjectiveExitGateResult =
  | Readonly<{ gated: false }>
  | Readonly<{
      gated: true
      reason: 'objective-incomplete'
    }>

export type GeneratedObjectiveExitBindingContext = Readonly<{
  generatedPlay: boolean
  provenance: RoomProvenance | 'authored' | 'static' | undefined
  room: LoadedRoom
  questSpec: QuestSpec | null | undefined
  consequenceCatalog: unknown
  independentGate: GeneratedMechanicalGate | null | undefined
}>

export type GeneratedObjectiveExitBindingSelectionContext =
  GeneratedObjectiveExitBindingContext & Readonly<{
    progressUnlocksExit: boolean
  }>

export type GeneratedObjectiveExitGateEvaluationContext =
  GeneratedObjectiveExitBindingContext & Readonly<{
    attemptedExitId: string
    binding: unknown
    state: WorldState
  }>

type ValidatedBindingContext = Readonly<{
  binding: GeneratedObjectiveExitBinding
  quest: QuestSpec
  catalog: MeaningfulObjectConsequenceCatalog
  consequence: MeaningfulObjectConsequenceSpec
  sourceObject: RoomObject
}>

const GENERATED_OBJECTIVE_ID = 'generated-0'
const BindingSchema = z.object({
  objectiveId: z.string().trim().min(1),
  exitId: z.string().trim().min(1),
}).strict()

const OPEN_RESULT: GeneratedObjectiveExitGateResult = { gated: false }
const INCOMPLETE_RESULT: GeneratedObjectiveExitGateResult = {
  gated: true,
  reason: 'objective-incomplete',
}

/** Parses only the small, cache-owned binding envelope; all room context is validated separately. */
export function parseGeneratedObjectiveExitBinding(input: unknown): GeneratedObjectiveExitBinding | null {
  if (!isPlainObject(input)) return null
  const parsed = BindingSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/**
 * Validates an untrusted cached or constructed binding against trusted current-room inputs.
 * It deliberately returns null rather than throwing so stale cache data fails closed.
 */
export function validateGeneratedObjectiveExitBinding(
  input: GeneratedObjectiveExitBindingContext & Readonly<{ binding: unknown }>,
): GeneratedObjectiveExitBinding | null {
  return resolveValidatedBinding(input)?.binding ?? null
}

/**
 * Derives a canonical binding only from fully validated room-local data.
 * The optional provider proposal is intentionally not an input to this function.
 */
export function selectGeneratedObjectiveExitBinding(
  input: GeneratedObjectiveExitBindingSelectionContext,
): GeneratedObjectiveExitBinding | null {
  if (input.progressUnlocksExit !== true) return null

  const quest = canonicalQuest(input.questSpec, input.room.id)
  const catalog = quest === null
    ? null
    : validateMeaningfulObjectConsequenceCatalog(input.consequenceCatalog, {
      room: input.room,
      questSpec: quest,
    })
  if (!baseContextIsValid(input, quest) || catalog === null) return null

  const objectiveConsequences = objectiveConsequencesFor(catalog, quest.objectives[0]!.id)
  if (objectiveConsequences.length !== 1) return null

  const candidates = input.room.objects
    .flatMap((object) => {
      const target = eligibleForwardExitTarget(input, object)
      return target === null || object.id === undefined
        ? []
        : [{ exitId: object.id, toRoomId: target }]
    })
    .sort((left, right) => codeUnitCompare(left.toRoomId, right.toRoomId)
      || codeUnitCompare(left.exitId, right.exitId))

  for (const candidate of candidates) {
    const binding = { objectiveId: quest.objectives[0]!.id, exitId: candidate.exitId }
    const validated = validateGeneratedObjectiveExitBinding({ ...input, binding })
    if (validated !== null) return validated
  }
  return null
}

/**
 * Re-derives availability from authoritative state on each attempted exit.
 * Invalid, stale, or terminally stranded data always fails open.
 */
export function evaluateGeneratedObjectiveExitGate(
  input: GeneratedObjectiveExitGateEvaluationContext,
): GeneratedObjectiveExitGateResult {
  const resolved = resolveValidatedBinding(input)
  if (resolved === null || input.attemptedExitId !== resolved.binding.exitId) return OPEN_RESULT

  const objective = evaluateQuest(resolved.quest, input.state, { meaningfulObjectProgression: true })
    .objectives.find((entry) => entry.id === resolved.binding.objectiveId)
  if (objective === undefined || objective.done) return OPEN_RESULT

  return sourceIsTerminal(resolved.sourceObject, resolved.consequence, input.state, input.room.id)
    ? OPEN_RESULT
    : INCOMPLETE_RESULT
}

function resolveValidatedBinding(
  input: GeneratedObjectiveExitBindingContext & Readonly<{ binding: unknown }>,
): ValidatedBindingContext | null {
  const binding = parseGeneratedObjectiveExitBinding(input.binding)
  const quest = canonicalQuest(input.questSpec, input.room.id)
  if (binding === null || !baseContextIsValid(input, quest)) return null

  const catalog = validateMeaningfulObjectConsequenceCatalog(input.consequenceCatalog, {
    room: input.room,
    questSpec: quest,
  })
  if (catalog === null || binding.objectiveId !== quest.objectives[0]!.id) return null

  const consequences = objectiveConsequencesFor(catalog, binding.objectiveId)
  if (consequences.length !== 1) return null
  const consequence = consequences[0]!
  const sourceObjects = input.room.objects.filter((object) => object.id === consequence.objectId)
  if (sourceObjects.length !== 1) return null

  const exits = input.room.objects.filter((object) => object.id === binding.exitId)
  if (exits.length !== 1 || eligibleForwardExitTarget(input, exits[0]!) === null) return null

  return { binding, quest, catalog, consequence, sourceObject: sourceObjects[0]! }
}

function baseContextIsValid(
  input: GeneratedObjectiveExitBindingContext,
  quest: QuestSpec | null,
): quest is QuestSpec {
  return input.generatedPlay === true
    && input.provenance === 'generated'
    && quest !== null
}

function canonicalQuest(raw: QuestSpec | null | undefined, roomId: string): QuestSpec | null {
  const parsed = QuestSpecSchema.safeParse(raw)
  if (!parsed.success) return null
  const quest = parsed.data
  return quest.questId === `${roomId}-objective`
    && quest.anchorRoomId === roomId
    && quest.objectives.length === 1
    && quest.objectives[0]?.id === GENERATED_OBJECTIVE_ID
    ? quest
    : null
}

function objectiveConsequencesFor(
  catalog: MeaningfulObjectConsequenceCatalog,
  objectiveId: string,
): MeaningfulObjectConsequenceSpec[] {
  return catalog.consequences.filter(
    (consequence) => consequence.objective?.objectiveId === objectiveId && consequence.objective.toStage === 1,
  )
}

function eligibleForwardExitTarget(
  input: GeneratedObjectiveExitBindingContext,
  object: RoomObject,
): string | null {
  if (object.id === undefined || object.id.trim().length === 0 || isReturnExitObject(object)) return null
  const interaction = 'interaction' in object ? object.interaction : undefined
  const exit = interaction?.exit
  if (exit === undefined
    || interaction?.encounter !== undefined
    || interaction?.dialogue !== undefined
    || interaction?.effect !== undefined
  ) return null

  const target = parseGeneratedExitTargetId(exit.toRoomId)
  if (target === null || target.parentId !== input.room.id) return null
  if (input.room.objects.filter((candidate) => candidate.id === object.id).length !== 1) return null
  if (hasIndependentGateFor(input.independentGate, input.room, exit.toRoomId)) return null
  return exit.toRoomId
}

function hasIndependentGateFor(
  gate: GeneratedMechanicalGate | null | undefined,
  room: LoadedRoom,
  toRoomId: string,
): boolean {
  return gate !== null
    && gate !== undefined
    && isGeneratedGateSatisfiable(gate, room)
    && gate.effect.toRoomId === toRoomId
}

function sourceIsTerminal(
  object: RoomObject,
  consequence: MeaningfulObjectConsequenceSpec,
  state: WorldState,
  roomId: string,
): boolean {
  const family = meaningfulObjectFamily(object)
  if (family === undefined) return false
  const objectState = deriveMeaningfulObjectState(object, state.roomStates[roomId], family)
  return (consequence.action === 'read' && objectState === 'read')
    || (consequence.action === 'search' && objectState === 'looted')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
