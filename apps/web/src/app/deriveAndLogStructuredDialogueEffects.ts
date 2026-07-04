import type { DialogueSemanticEvent } from '../domain/dialogueEvents/contracts'
import {
  deriveStructuredDialogueEffects,
  type StructuredDialogueEffectDerivationOptions,
} from '../domain/structuredDialogueEffects/derive'
import type { StructuredDialogueEffect } from '../domain/structuredDialogueEffects/contracts'
import type { Logger } from '../platform/logger/Logger'

export type DeriveAndLogStructuredDialogueEffectsInput = {
  events: readonly DialogueSemanticEvent[]
  makeEffectId: StructuredDialogueEffectDerivationOptions['makeEffectId']
  logger: Pick<Logger, 'info'>
}

export function deriveAndLogStructuredDialogueEffects(
  input: DeriveAndLogStructuredDialogueEffectsInput,
): StructuredDialogueEffect[] {
  const effects = deriveStructuredDialogueEffects(input.events, {
    makeEffectId: input.makeEffectId,
  })

  input.logger.info('structured dialogue effects derived', {
    count: effects.length,
    kinds: joinUnique(effects.map((effect) => effect.kind)),
    sourceKinds: joinUnique(effects.map((effect) => effect.sourceKind)),
    actors: joinUnique(effects.map((effect) => effect.actor)),
    targets: joinUnique(effects.map((effect) => effect.target)),
    confidences: joinUnique(effects.map((effect) => effect.confidence)),
    ...(effects.length > 0
      ? {
          worldId: joinUnique(effects.map((effect) => effect.scope.worldId)),
          sessionId: joinUnique(effects.map((effect) => effect.scope.sessionId)),
          roomId: joinUnique(effects.map((effect) => effect.scope.roomId)),
        }
      : {}),
    ...optionalJoined('npcId', effects.map((effect) => effect.scope.npcId)),
    ...optionalJoined('promptId', effects.map((effect) => effect.provenance.promptId)),
  })

  return effects
}

function joinUnique(values: readonly string[]): string {
  return [...new Set(values)].join(',')
}

function optionalJoined(key: 'npcId' | 'promptId', values: readonly (string | undefined)[]): Record<string, string> {
  const joined = joinUnique(values.filter((value): value is string => value !== undefined))
  return joined.length > 0 ? { [key]: joined } : {}
}
