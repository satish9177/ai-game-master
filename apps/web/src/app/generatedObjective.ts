import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import type { QuestSpec } from '../domain/quests/questSpec'
import { assembleObjective } from '../domain/quests/assembleObjective'
import {
  buildGeneratedMeaningfulConsequenceCatalog,
  parseGeneratedObjectiveEnvelope,
} from '../domain/objectPurpose/generatedMeaningfulConsequenceAttachment'
import type { MeaningfulObjectConsequenceCatalog } from '../domain/objectPurpose/meaningfulObjectConsequences'

export type GeneratedObjectiveQuestAttachment = {
  questSpec: QuestSpec
  hint: string
  completionHint: string
}

export type GeneratedObjectiveAndConsequenceAttachment = Readonly<{
  objective: GeneratedObjectiveQuestAttachment | null
  consequenceCatalog: MeaningfulObjectConsequenceCatalog | null
}>

export async function buildGeneratedObjectiveAndConsequenceAttachment(
  room: LoadedRoom,
  generator: ObjectiveGenerator,
): Promise<GeneratedObjectiveAndConsequenceAttachment> {
  try {
    const raw = await generator.generate(room)
    if (raw == null) return { objective: null, consequenceCatalog: null }
    const envelope = parseGeneratedObjectiveEnvelope(raw)
    if (envelope === null) return { objective: null, consequenceCatalog: null }
    const assembled = assembleObjective(envelope.objectiveRaw, room)
    const objective = assembled.spec == null || assembled.hint == null || assembled.completionHint == null
      ? null
      : { questSpec: assembled.spec, hint: assembled.hint, completionHint: assembled.completionHint }
    const consequenceCatalog = buildGeneratedMeaningfulConsequenceCatalog({
      room,
      generatedPlay: true,
      proposals: envelope.proposals,
      ...(objective === null ? {} : { questSpec: objective.questSpec }),
    })
    return { objective, consequenceCatalog }
  } catch {
    return { objective: null, consequenceCatalog: null }
  }
}

export async function buildGeneratedObjectiveAttachment(
  room: LoadedRoom,
  generator: ObjectiveGenerator,
): Promise<GeneratedObjectiveQuestAttachment | null> {
  return (await buildGeneratedObjectiveAndConsequenceAttachment(room, generator)).objective
}

export async function buildGeneratedObjectiveQuestSpec(
  room: LoadedRoom,
  generator: ObjectiveGenerator,
): Promise<QuestSpec | null> {
  return (await buildGeneratedObjectiveAttachment(room, generator))?.questSpec ?? null
}
