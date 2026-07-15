import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomProvenance } from '../domain/assembleRoom'
import { buildNPCObjectiveContext } from '../domain/dialogue/buildNPCObjectiveContext'
import type { QuestDialogueContext } from '../domain/dialogue/contracts'
import type { GeneratedStoryThreadKind } from '../domain/generatedStoryThread'
import type { GeneratedRoomVisualTheme } from '../domain/generatedRoomThemeVocabulary'
import { resolvedObjectIds } from '../domain/interactions/resolvedObjects'
import {
  buildRoomMemorySaveJson as buildRoomMemorySaveStateJson,
  filterRestorableRoomMemories,
  loadRoomMemorySaveState,
  type RoomMemorySaveLoadCode,
} from '../domain/memory/roomMemorySaveState'
import { buildGeneratedRoomCacheSaveState } from '../domain/quests/generatedRoomCacheSaveState'
import { buildGeneratedQuestSaveState } from '../domain/quests/generatedQuestSaveState'
import type { QuestView } from '../domain/quests/evaluateQuest'
import type { QuestSpec } from '../domain/quests/questSpec'
import type { MeaningfulObjectConsequenceCatalog } from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import type { UsageGuardConfig } from '../domain/usage/usageGuard'
import { canAttemptOptional } from '../domain/usage/usageGuard'
import type { WorldState } from '../domain/world/worldState'
import type { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import type { FamiliarityBucket } from '../domain/npcRelationship/dialogueContext'
import type { NpcRelationshipState } from '../domain/npcRelationship/contracts'
import {
  filterRestorableRelationships,
  loadNpcRelationshipSaveState,
  type NpcRelationshipSaveLoadCode,
} from '../domain/npcRelationship/relationshipSaveState'
import type { Logger } from '../platform/logger/Logger'
import {
  buildGeneratedObjectiveAttachment,
  buildGeneratedObjectiveAndConsequenceAttachment,
  type GeneratedObjectiveQuestAttachment,
} from './generatedObjective'
import type { GeneratedObjectiveAndConsequenceAttachment } from './generatedObjective'
import {
  decideMemoryFeedback,
  EMPTY_PROMOTION_SUMMARY,
  type MemoryFeedbackMessage,
  type PromotionSummary,
} from './memoryFeedback'
import { decideRelationshipFeedback, type RelationshipFeedbackMessage } from './relationshipFeedback'

export type QuestHintState = {
  hint: string
  completionHint: string
}

export type PerRoomObjectiveMemo = Map<string, GeneratedObjectiveQuestAttachment | null>

export type GeneratedRoomCacheSnapshotEntry = {
  roomId: string
  room: LoadedRoom
  provenance?: RoomProvenance
}

export type CurrentPlayIdentity = {
  room: Pick<LoadedRoom, 'id'>
  sessionId: string
} | null

/** The active room's trusted, non-persisted consequence view. */
export type MeaningfulObjectTrustedContext = Readonly<{
  roomId: string
  consequenceCatalog?: MeaningfulObjectConsequenceCatalog
  questSpec?: QuestSpec
}>

export function deriveMeaningfulObjectTrustedContext(input: {
  room: Pick<LoadedRoom, 'id'>
  consequenceCatalogs?: ReadonlyMap<string, MeaningfulObjectConsequenceCatalog>
  questSpec?: QuestSpec | null
}): MeaningfulObjectTrustedContext {
  const consequenceCatalog = input.consequenceCatalogs?.get(input.room.id)
  return {
    roomId: input.room.id,
    ...(consequenceCatalog !== undefined ? { consequenceCatalog } : {}),
    ...(input.questSpec !== null && input.questSpec !== undefined
      ? { questSpec: input.questSpec }
      : {}),
  }
}

export function applyGeneratedMeaningfulConsequenceCatalog(input: {
  consequenceCatalogs?: ReadonlyMap<string, MeaningfulObjectConsequenceCatalog>
  destinationRoomId: string
  activeRoom: Pick<LoadedRoom, 'id'>
  activeQuestSpec?: QuestSpec | null
  catalog: MeaningfulObjectConsequenceCatalog
}): Readonly<{
  consequenceCatalogs: Map<string, MeaningfulObjectConsequenceCatalog>
  activeTrustedContext?: MeaningfulObjectTrustedContext
}> {
  const consequenceCatalogs = new Map(input.consequenceCatalogs)
  consequenceCatalogs.set(input.destinationRoomId, input.catalog)
  return {
    consequenceCatalogs,
    ...(input.activeRoom.id === input.destinationRoomId
      ? {
          activeTrustedContext: deriveMeaningfulObjectTrustedContext({
            room: input.activeRoom,
            consequenceCatalogs,
            questSpec: input.activeQuestSpec,
          }),
        }
      : {}),
  }
}

export type RuntimeRoomMemoryRestoreSummary = {
  status: 'missing' | 'invalid' | 'restored'
  reason?: 'missing' | RoomMemorySaveLoadCode
  restoredCount: number
  droppedCount: number
  droppedByScope: number
  droppedBySource: number
  droppedByText: number
  droppedByCap: number
}

const emptyRoomMemoryRestoreSummary = {
  restoredCount: 0,
  droppedCount: 0,
  droppedByScope: 0,
  droppedBySource: 0,
  droppedByText: 0,
  droppedByCap: 0,
} as const

export function readPerRoomObjectiveMemo(memo: PerRoomObjectiveMemo, roomId: string): {
  cached: boolean
  questSpec: QuestSpec | null
  questHints: QuestHintState | null
} {
  if (!memo.has(roomId)) return { cached: false, questSpec: null, questHints: null }
  const attachment = memo.get(roomId) ?? null
  return {
    cached: true,
    questSpec: attachment?.questSpec ?? null,
    questHints: attachment
      ? { hint: attachment.hint, completionHint: attachment.completionHint }
      : null,
  }
}

export function shouldStartPerRoomObjectiveAttach(input: {
  objectivesPerRoom?: boolean
  provenance?: RoomProvenance
  memo: PerRoomObjectiveMemo
  roomId: string
}): boolean {
  return input.objectivesPerRoom === true
    && input.provenance === 'generated'
    && !input.memo.has(input.roomId)
}

export async function attachPerRoomObjectiveOnEnter(input: {
  room: LoadedRoom
  sessionId: string
  memo: PerRoomObjectiveMemo
  usageCount: number
  guardConfig: UsageGuardConfig
  objectiveGenerator: ObjectiveGenerator
  logger: Pick<Logger, 'debug' | 'info'>
  getCurrentPlay: () => CurrentPlayIdentity
  applyAttachment: (attachment: GeneratedObjectiveQuestAttachment | null) => void
  applyCatalog?: (catalog: MeaningfulObjectConsequenceCatalog | null) => void
  refreshAfterApply: () => Promise<void>
  buildAttachment?: typeof buildGeneratedObjectiveAttachment
}): Promise<void> {
  const roomId = input.room.id
  if (input.memo.has(roomId)) return

  let attachment: GeneratedObjectiveQuestAttachment | null = null
  let catalog: MeaningfulObjectConsequenceCatalog | null = null
  if (canAttemptOptional({ count: input.usageCount }, input.guardConfig)) {
    input.logger.info('optional objective generation allowed', {
      count: input.usageCount,
      cap: input.guardConfig.cap,
      roomId,
    })
    if (input.buildAttachment !== undefined) {
      attachment = await input.buildAttachment(input.room, input.objectiveGenerator)
    } else {
      const combined: GeneratedObjectiveAndConsequenceAttachment = await buildGeneratedObjectiveAndConsequenceAttachment(
        input.room,
        input.objectiveGenerator,
      )
      attachment = combined.objective
      catalog = combined.consequenceCatalog
    }
  } else {
    input.logger.info('optional objective generation skipped', {
      count: input.usageCount,
      cap: input.guardConfig.cap,
      roomId,
      reason: 'usage-cap',
    })
  }

  input.memo.set(roomId, attachment)
  input.applyCatalog?.(catalog)

  const current = input.getCurrentPlay()
  if (current?.sessionId !== input.sessionId || current.room.id !== roomId) {
    input.logger.debug('per-room objective stale', { roomId })
    return
  }

  input.applyAttachment(attachment)
  input.logger.debug('per-room objective attached', { roomId, attached: attachment != null })
  await input.refreshAfterApply()
}

/**
 * Build the parked generated-quest restore blob for the save path (generated
 * quest save/load v0; ADR-0059).
 *
 * Returns a serialized `GeneratedQuestSaveState` string only for generated play
 * (`objectivesPerRoom === true`). Authored/demo play returns `undefined` so the
 * save slot wrapper stays byte-identical to the pre-feature format. If the live
 * safe state fails the schema guard in `buildGeneratedQuestSaveState`, returns
 * `undefined` and the authoritative save proceeds without the blob.
 *
 * This is a pure, side-effect-free projection of already-validated, already-
 * sanitized live state. It makes no provider/generator/LLM call and never
 * increments the usage meter. The blob carries only data that is permitted by
 * ADR-0059 (validated `RoomSpec`, sanitized `QuestSpec`/hints, closed-enum
 * `storyKind`); it must never be logged.
 */
export function buildGeneratedQuestSaveJson(
  play: {
    room: LoadedRoom
    objectivesPerRoom?: boolean
    questSpec?: QuestSpec
    storyKind?: GeneratedStoryThreadKind
  },
  hints: QuestHintState | null,
): string | undefined {
  if (play.objectivesPerRoom !== true) return undefined

  const saveState = buildGeneratedQuestSaveState({
    room: play.room,
    objectivesPerRoom: true,
    ...(play.questSpec !== undefined ? { questSpec: play.questSpec } : {}),
    ...(play.storyKind !== undefined ? { storyKind: play.storyKind } : {}),
    ...(hints !== null ? { hints } : {}),
  })

  return saveState !== null ? JSON.stringify(saveState) : undefined
}

export function buildGeneratedRoomCacheSaveJson(input: {
  room: LoadedRoom
  objectivesPerRoom?: boolean
  cachedRooms: GeneratedRoomCacheSnapshotEntry[]
  worldState: WorldState
  themePack?: GeneratedRoomVisualTheme
  objectives?: ReadonlyMap<string, unknown>
  consequenceCatalogs?: ReadonlyMap<string, MeaningfulObjectConsequenceCatalog>
  currentQuestSpec?: QuestSpec
}): string | undefined {
  if (input.objectivesPerRoom !== true) return undefined

  const currentSnapshot = input.cachedRooms.find((entry) => entry.roomId === input.room.id)
  const currentEntry = {
    room: input.room,
    provenance: currentSnapshot?.provenance ?? 'generated',
    ...(input.consequenceCatalogs?.get(input.room.id) !== undefined
      ? { consequenceCatalog: input.consequenceCatalogs.get(input.room.id), questSpec: input.currentQuestSpec }
      : {}),
  } as const
  const visitedEntries = input.cachedRooms
    .filter((entry) => entry.roomId !== input.room.id)
    .filter((entry) => input.worldState.roomStates[entry.roomId]?.visited === true)
    .map((entry) => {
      const objective = input.objectives?.get(entry.roomId)
      const consequenceCatalog = input.consequenceCatalogs?.get(entry.roomId)
      return {
        room: entry.room,
        provenance: entry.provenance ?? 'generated',
        ...(objective != null ? { objective } : {}),
        ...(consequenceCatalog !== undefined ? { consequenceCatalog } : {}),
      }
    })

  const saveState = buildGeneratedRoomCacheSaveState({
    rooms: [currentEntry, ...visitedEntries],
    ...(input.themePack !== undefined ? { themePack: input.themePack } : {}),
  })

  return saveState !== null ? JSON.stringify(saveState) : undefined
}

export function buildRuntimeRoomMemorySaveJson(
  store: InMemoryRoomMemoryStore,
  scope: { worldId: string; sessionId: string },
): string | undefined {
  return buildRoomMemorySaveStateJson(store.snapshotAll(), scope) ?? undefined
}

export function restoreRuntimeRoomMemoryFromSlot(input: {
  store: InMemoryRoomMemoryStore
  roomMemoryJson?: string
  scope: { worldId: string; sessionId: string }
}): RuntimeRoomMemoryRestoreSummary {
  input.store.restoreAll([])

  if (input.roomMemoryJson == null) {
    return { status: 'missing', reason: 'missing', ...emptyRoomMemoryRestoreSummary }
  }

  const loaded = loadRoomMemorySaveState(input.roomMemoryJson)
  if (!loaded.ok) {
    return { status: 'invalid', reason: loaded.code, ...emptyRoomMemoryRestoreSummary }
  }

  const restorable = filterRestorableRoomMemories(loaded.state.records, input.scope)
  input.store.restoreAll(restorable.records)

  return {
    status: 'restored',
    restoredCount: restorable.keptCount,
    droppedCount: restorable.droppedCount,
    droppedByScope: restorable.droppedByScope,
    droppedBySource: restorable.droppedBySource,
    droppedByText: restorable.droppedByText,
    droppedByCap: restorable.droppedByCap,
  }
}

export type NpcRelationshipRestoreDiagnostics = {
  status: 'missing' | 'invalid' | 'restored'
  reason?: 'missing' | NpcRelationshipSaveLoadCode
  restoredCount: number
  droppedCount: number
  droppedByScope: number
  droppedByCap: number
}

export type NpcRelationshipRestoreResult = {
  records: NpcRelationshipState[]
  diagnostics: NpcRelationshipRestoreDiagnostics
}

const emptyNpcRelationshipRestoreDiagnostics = {
  restoredCount: 0,
  droppedCount: 0,
  droppedByScope: 0,
  droppedByCap: 0,
} as const

/**
 * Restore helper for the NPC relationship sidecar (npc-relationship-persistence-v0,
 * Slice 3). Mirrors `restoreRuntimeRoomMemoryFromSlot`, but — unlike that
 * store-mutating helper — returns surviving records instead of writing them
 * anywhere: `relationshipsRef` re-seeding is App.tsx wiring (Slice 4), and
 * this helper must not touch it directly. Never calls the reducer or feedback
 * derivation; restore is a silent projection re-seed only. `diagnostics` is
 * deliberately separate from `records` so a caller can log it alone without
 * risking raw axis values or NPC names.
 */
export function restoreNpcRelationshipsFromSlot(input: {
  npcRelationshipJson?: string
  scope: { worldId: string; sessionId: string }
}): NpcRelationshipRestoreResult {
  if (input.npcRelationshipJson == null) {
    return {
      records: [],
      diagnostics: { status: 'missing', reason: 'missing', ...emptyNpcRelationshipRestoreDiagnostics },
    }
  }

  const loaded = loadNpcRelationshipSaveState(input.npcRelationshipJson)
  if (!loaded.ok) {
    return {
      records: [],
      diagnostics: { status: 'invalid', reason: loaded.code, ...emptyNpcRelationshipRestoreDiagnostics },
    }
  }

  const restorable = filterRestorableRelationships(loaded.state.records, input.scope)

  return {
    records: restorable.records,
    diagnostics: {
      status: 'restored',
      restoredCount: restorable.keptCount,
      droppedCount: restorable.droppedCount,
      droppedByScope: restorable.droppedByScope,
      droppedByCap: restorable.droppedByCap,
    },
  }
}

export function resolvedObjectIdsForRoom(
  state: WorldState,
  room: LoadedRoom,
): ReadonlySet<string> {
  return resolvedObjectIds(room, state.roomStates[room.id])
}

export function resolvedObjectIdsForGeneratedPlay(input: {
  objectivesPerRoom?: boolean
  state: WorldState
  room: LoadedRoom
}): ReadonlySet<string> | undefined {
  return input.objectivesPerRoom === true
    ? resolvedObjectIdsForRoom(input.state, input.room)
    : undefined
}

export function buildQuestStage(input: {
  quest: QuestView | null
  questHints: QuestHintState | null
  questSpec: QuestSpec | null
}): QuestDialogueContext | undefined {
  const { quest, questHints, questSpec } = input
  if (quest == null) return undefined

  const objectiveContext = questHints != null
    ? buildNPCObjectiveContext(
        objectiveForQuestStage(quest, questSpec),
        quest.status === 'complete' ? 'complete' : 'active',
      )
    : undefined

  return {
    activeObjectiveId: quest.activeObjectiveId,
    status: quest.status,
    ...(questHints ? { hint: questHints.hint, completionHint: questHints.completionHint } : {}),
    ...(objectiveContext !== undefined ? { objective: objectiveContext } : {}),
  }
}

/**
 * App-owned memory feedback state (room-memory-visible-feedback-v0, Slice 4).
 *
 * Wraps the pure `decideMemoryFeedback` gate so the composition root can fold
 * promotion/recall outcomes into a single feedback slot without duplicating
 * the precedence/anti-spam rules. `shownForRoomEntrySeq` is the anti-spam key
 * (never reset except by advancing to a new room entry); `message` is the
 * currently visible line, cleared separately on room entry so a still-valid
 * `shownForRoomEntrySeq` keeps suppressing repeat recall feedback within the
 * same entry per the approved plan.
 */
export type MemoryFeedbackState = Readonly<{
  message: MemoryFeedbackMessage | null
  shownForRoomEntrySeq: number | null
}>

export const INITIAL_MEMORY_FEEDBACK_STATE: MemoryFeedbackState = {
  message: null,
  shownForRoomEntrySeq: null,
}

export function memoryFeedbackAfterPromotion(
  state: MemoryFeedbackState,
  input: { promotionSummary: PromotionSummary; roomEntrySeq: number },
): MemoryFeedbackState {
  const message = decideMemoryFeedback({
    promotionSummary: input.promotionSummary,
    hasRecalledMemory: false,
    roomEntrySeq: input.roomEntrySeq,
    shownForRoomEntrySeq: state.shownForRoomEntrySeq,
  })
  return message === null ? state : { message, shownForRoomEntrySeq: input.roomEntrySeq }
}

export function memoryFeedbackAfterRecall(
  state: MemoryFeedbackState,
  input: { hasRecalledMemory: boolean; roomEntrySeq: number },
): MemoryFeedbackState {
  const message = decideMemoryFeedback({
    promotionSummary: EMPTY_PROMOTION_SUMMARY,
    hasRecalledMemory: input.hasRecalledMemory,
    roomEntrySeq: input.roomEntrySeq,
    shownForRoomEntrySeq: state.shownForRoomEntrySeq,
  })
  return message === null ? state : { message, shownForRoomEntrySeq: input.roomEntrySeq }
}

export function memoryFeedbackOnRoomEntry(state: MemoryFeedbackState): MemoryFeedbackState {
  return state.message === null ? state : { ...state, message: null }
}

/**
 * App-owned relationship feedback state (relationship-visible-feedback-v0,
 * Slice 2). Mirrors `MemoryFeedbackState` but needs no anti-spam key: a
 * familiarity bucket crossing is inherently once-per-crossing because
 * familiarity is monotonic non-decreasing (see `relationshipFeedback.ts`).
 */
export type RelationshipFeedbackState = Readonly<{
  message: RelationshipFeedbackMessage | null
}>

export const INITIAL_RELATIONSHIP_FEEDBACK_STATE: RelationshipFeedbackState = {
  message: null,
}

export function relationshipFeedbackAfterReduction(
  state: RelationshipFeedbackState,
  input: { prevBucket: FamiliarityBucket; nextBucket: FamiliarityBucket },
): RelationshipFeedbackState {
  const message = decideRelationshipFeedback(input.prevBucket, input.nextBucket)
  return message === null ? state : { message }
}

export function relationshipFeedbackOnRoomEntry(
  state: RelationshipFeedbackState,
): RelationshipFeedbackState {
  return state.message === null ? state : { message: null }
}

/**
 * Selects the single transient feedback line to render, precedence
 * memory-created > memory-recalled > relationship-familiarity (durable-world
 * signals win). `memoryMessage` already encodes the created/recalled choice,
 * so this only needs to fall back to the relationship message.
 */
export function selectTransientFeedbackMessage(
  memoryMessage: MemoryFeedbackMessage | null,
  relationshipMessage: RelationshipFeedbackMessage | null,
): MemoryFeedbackMessage | RelationshipFeedbackMessage | null {
  return memoryMessage ?? relationshipMessage
}

function objectiveForQuestStage(quest: QuestView, questSpec: QuestSpec | null) {
  if (questSpec == null) return null
  if (quest.activeObjectiveId != null) {
    return questSpec.objectives.find((objective) => objective.id === quest.activeObjectiveId) ?? null
  }
  if (quest.status !== 'complete') return null
  return questSpec.objectives.at(-1) ?? null
}
