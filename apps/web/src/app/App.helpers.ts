import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomProvenance } from '../domain/assembleRoom'
import { buildNPCObjectiveContext } from '../domain/dialogue/buildNPCObjectiveContext'
import type { QuestDialogueContext } from '../domain/dialogue/contracts'
import { resolvedObjectIds } from '../domain/interactions/resolvedObjects'
import type { QuestView } from '../domain/quests/evaluateQuest'
import type { QuestSpec } from '../domain/quests/questSpec'
import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import type { UsageGuardConfig } from '../domain/usage/usageGuard'
import { canAttemptOptional } from '../domain/usage/usageGuard'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import {
  buildGeneratedObjectiveAttachment,
  type GeneratedObjectiveQuestAttachment,
} from './generatedObjective'

export type QuestHintState = {
  hint: string
  completionHint: string
}

export type PerRoomObjectiveMemo = Map<string, GeneratedObjectiveQuestAttachment | null>

export type CurrentPlayIdentity = {
  room: Pick<LoadedRoom, 'id'>
  sessionId: string
} | null

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
  refreshAfterApply: () => Promise<void>
  buildAttachment?: typeof buildGeneratedObjectiveAttachment
}): Promise<void> {
  const roomId = input.room.id
  if (input.memo.has(roomId)) return

  const buildAttachment = input.buildAttachment ?? buildGeneratedObjectiveAttachment
  let attachment: GeneratedObjectiveQuestAttachment | null = null
  if (canAttemptOptional({ count: input.usageCount }, input.guardConfig)) {
    input.logger.info('optional objective generation allowed', {
      count: input.usageCount,
      cap: input.guardConfig.cap,
      roomId,
    })
    attachment = await buildAttachment(input.room, input.objectiveGenerator)
  } else {
    input.logger.info('optional objective generation skipped', {
      count: input.usageCount,
      cap: input.guardConfig.cap,
      roomId,
      reason: 'usage-cap',
    })
  }

  input.memo.set(roomId, attachment)

  const current = input.getCurrentPlay()
  if (current?.sessionId !== input.sessionId || current.room.id !== roomId) {
    input.logger.debug('per-room objective stale', { roomId })
    return
  }

  input.applyAttachment(attachment)
  input.logger.debug('per-room objective attached', { roomId, attached: attachment != null })
  await input.refreshAfterApply()
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

function objectiveForQuestStage(quest: QuestView, questSpec: QuestSpec | null) {
  if (questSpec == null) return null
  if (quest.activeObjectiveId != null) {
    return questSpec.objectives.find((objective) => objective.id === quest.activeObjectiveId) ?? null
  }
  if (quest.status !== 'complete') return null
  return questSpec.objectives.at(-1) ?? null
}
