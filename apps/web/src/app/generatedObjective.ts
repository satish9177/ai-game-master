import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import type { QuestSpec } from '../domain/quests/questSpec'
import { assembleObjective } from '../domain/quests/assembleObjective'

export type GeneratedObjectiveQuestAttachment = {
  questSpec: QuestSpec
  hint: string
  completionHint: string
}

export async function buildGeneratedObjectiveAttachment(
  room: LoadedRoom,
  generator: ObjectiveGenerator,
): Promise<GeneratedObjectiveQuestAttachment | null> {
  try {
    const raw = await generator.generate(room)
    if (raw == null) return null
    const assembled = assembleObjective(raw, room)
    if (assembled.spec == null || assembled.hint == null || assembled.completionHint == null) return null
    return {
      questSpec: assembled.spec,
      hint: assembled.hint,
      completionHint: assembled.completionHint,
    }
  } catch {
    return null
  }
}

export async function buildGeneratedObjectiveQuestSpec(
  room: LoadedRoom,
  generator: ObjectiveGenerator,
): Promise<QuestSpec | null> {
  return (await buildGeneratedObjectiveAttachment(room, generator))?.questSpec ?? null
}
