import type { DialogueSemanticEvent } from '../dialogueEvents/contracts'
import { validateDialogueSemanticEvent } from '../dialogueEvents/validate'
import {
  STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
  type StructuredDialogueEffect,
  type StructuredDialogueEffectKind,
} from './contracts'
import { validateStructuredDialogueEffect } from './validate'

export interface StructuredDialogueEffectDerivationOptions {
  makeEffectId: (sourceEvent: DialogueSemanticEvent, indexInTurn: number) => string
}

export const EFFECT_KIND_BY_SOURCE_KIND: Partial<Record<DialogueSemanticEvent['kind'], StructuredDialogueEffectKind>> = {
  player_asked_question: 'player_question_effect_candidate',
  npc_responded: 'npc_response_effect_candidate',
  player_threatened_npc: 'player_threat_candidate',
  player_apologized: 'player_apology_candidate',
  player_thanked_npc: 'player_gratitude_candidate',
  player_insulted_npc: 'player_insult_candidate',
  player_refused_request: 'player_refusal_candidate',
  player_promised_help: 'player_promise_candidate',
  npc_warned_player: 'npc_warning_candidate',
  npc_offered_help: 'npc_offer_candidate',
  npc_refused_request: 'npc_refusal_candidate',
}

export function deriveStructuredDialogueEffects(
  events: readonly DialogueSemanticEvent[],
  options: StructuredDialogueEffectDerivationOptions,
): StructuredDialogueEffect[] {
  const effects: StructuredDialogueEffect[] = []

  for (const event of events) {
    const sourceEvent = validateDialogueSemanticEvent(event)

    if (sourceEvent === null) {
      continue
    }

    const kind = EFFECT_KIND_BY_SOURCE_KIND[sourceEvent.kind]

    if (kind === undefined) {
      continue
    }

    const effect = validateStructuredDialogueEffect({
      schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
      effectId: options.makeEffectId(sourceEvent, effects.length),
      kind,
      sourceEventId: sourceEvent.eventId,
      sourceKind: sourceEvent.kind,
      status: 'candidate',
      actor: sourceEvent.actor,
      target: sourceEvent.target,
      scope: sourceEvent.scope,
      provenance: sourceEvent.provenance,
      confidence: sourceEvent.confidence,
    })

    if (effect !== null) {
      effects.push(effect)
    }
  }

  return effects
}
