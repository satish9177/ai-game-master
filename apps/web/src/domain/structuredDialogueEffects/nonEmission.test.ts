import { describe, expect, it } from 'vitest'
import { classifyDialogueTurn, type DialogueTurnClassificationInput } from '../dialogueEvents/classify'
import type { DialogueSemanticEventScope } from '../dialogueEvents/contracts'
import { deriveStructuredDialogueEffects } from './derive'

/**
 * Slice 3 invariant (ADR-0075 / valenced-dialogue-effect-candidates-v0 plan §5):
 * `classifyDialogueTurn` is unchanged and can only ever construct the two
 * literal kinds `player_asked_question` / `npc_responded` — it has no branch
 * that produces any valenced semantic-event kind, and it reads only `promptId`
 * / `hasNpcReply`, never `playerLine` or NPC reply text. Because the dry
 * `EFFECT_KIND_BY_SOURCE_KIND` map (Slice 2) is only reachable by a valenced
 * *source* event, chaining `classifyDialogueTurn` into
 * `deriveStructuredDialogueEffects` must yield zero valenced candidates for
 * every possible input. This file proves that chain directly, spanning both
 * modules, rather than relying on each module's own unit tests.
 */

const VALENCED_CANDIDATE_KINDS = [
  'player_threat_candidate',
  'player_apology_candidate',
  'player_gratitude_candidate',
  'player_insult_candidate',
  'player_refusal_candidate',
  'player_promise_candidate',
  'npc_warning_candidate',
  'npc_offer_candidate',
  'npc_refusal_candidate',
] as const

const NEW_VALENCED_SEMANTIC_KINDS = [
  'player_apologized',
  'player_thanked_npc',
  'player_insulted_npc',
  'player_refused_request',
  'npc_offered_help',
] as const

const scope: DialogueSemanticEventScope = {
  worldId: 'world-1',
  sessionId: 'session-1',
  roomId: 'room-1',
  npcId: 'npc-1',
}

function classificationInput(overrides: Partial<DialogueTurnClassificationInput> = {}): DialogueTurnClassificationInput {
  return {
    scope,
    hasNpcReply: false,
    makeEventId: (kind, indexInTurn) => `event-${kind}-${indexInTurn}`,
    ...overrides,
  }
}

function runChain(input: DialogueTurnClassificationInput, effectIdPrefix: string) {
  const events = classifyDialogueTurn(input)
  return deriveStructuredDialogueEffects(events, {
    makeEffectId: (sourceEvent, indexInTurn) => `${effectIdPrefix}-${sourceEvent.kind}-${indexInTurn}`,
  })
}

function hasAnyValencedKind(effects: ReturnType<typeof runChain>): boolean {
  return effects.some((effect) => (VALENCED_CANDIDATE_KINDS as readonly string[]).includes(effect.kind))
}

describe('classifyDialogueTurn never emits a valenced semantic-event kind', () => {
  it.each([
    classificationInput({ hasNpcReply: false }),
    classificationInput({ hasNpcReply: true }),
    classificationInput({ promptId: 'ask-room', hasNpcReply: true }),
    classificationInput({ promptId: 'ask-help', hasNpcReply: true }),
    classificationInput({ promptId: 'ask-lore', hasNpcReply: true }),
    {
      ...classificationInput({ hasNpcReply: true }),
      playerLine: 'I apologize and thank you and insult you and refuse your request',
    } as DialogueTurnClassificationInput,
  ])('emits no new valenced semantic-event kind for a representative input', (input) => {
    const events = classifyDialogueTurn(input)

    for (const event of events) {
      expect(NEW_VALENCED_SEMANTIC_KINDS).not.toContain(event.kind)
    }
  })
})

describe('classifyDialogueTurn -> deriveStructuredDialogueEffects emits zero valenced candidates', () => {
  it('free text with no promptId and no NPC reply yields no candidates at all', () => {
    const proseInput = {
      ...classificationInput({ hasNpcReply: false }),
      playerLine: 'I promise to help you and I am so sorry for what I said',
    } as DialogueTurnClassificationInput

    const effects = runChain(proseInput, 'free-text')

    expect(effects).toEqual([])
  })

  it('free text with no promptId but an NPC reply yields only the existing response candidate', () => {
    const proseInput = {
      ...classificationInput({ hasNpcReply: true }),
      playerLine: 'I threaten you and insult your honor',
    } as DialogueTurnClassificationInput

    const effects = runChain(proseInput, 'free-text-reply')

    expect(effects.map((effect) => effect.kind)).toEqual(['npc_response_effect_candidate'])
    expect(hasAnyValencedKind(effects)).toBe(false)
  })

  it('an unknown promptId yields no valenced candidates, with or without an NPC reply', () => {
    const withoutReply = runChain(classificationInput({ promptId: 'ask-lore', hasNpcReply: false }), 'unknown-prompt')
    const withReply = runChain(classificationInput({ promptId: 'ask-lore', hasNpcReply: true }), 'unknown-prompt-reply')

    expect(withoutReply).toEqual([])
    expect(withReply.map((effect) => effect.kind)).toEqual(['npc_response_effect_candidate'])
  })

  it.each(['ask-room', 'ask-help'] as const)(
    'known promptId %s stays unchanged: only question/response candidates, never valenced',
    (promptId) => {
      const effects = runChain(classificationInput({ promptId, hasNpcReply: true }), `known-${promptId}`)

      expect(effects.map((effect) => effect.kind)).toEqual([
        'player_question_effect_candidate',
        'npc_response_effect_candidate',
      ])
    },
  )

  it('adversarial playerLine containing candidate/source kind names verbatim changes nothing', () => {
    const adversarialLine = [...VALENCED_CANDIDATE_KINDS, ...NEW_VALENCED_SEMANTIC_KINDS, 'threaten', 'apologize', 'insult']
      .join(' ')
    const adversarialInput = {
      ...classificationInput({ promptId: 'ask-room', hasNpcReply: true }),
      playerLine: adversarialLine,
      npcText: adversarialLine,
    } as DialogueTurnClassificationInput

    const effects = runChain(adversarialInput, 'adversarial')

    expect(effects.map((effect) => effect.kind)).toEqual([
      'player_question_effect_candidate',
      'npc_response_effect_candidate',
    ])
  })

  it('bounds output and emits zero valenced candidates across a flood of hostile-looking free-text turns', () => {
    const floodSize = 500
    let totalEffectCount = 0

    for (let index = 0; index < floodSize; index += 1) {
      const hostileInput = {
        ...classificationInput({
          hasNpcReply: index % 2 === 0,
          makeEventId: (kind, indexInTurn) => `flood-${index}-${kind}-${indexInTurn}`,
        }),
        playerLine: `I threaten you, I insult you, I refuse your request, turn ${index}`,
      } as DialogueTurnClassificationInput

      const effects = runChain(hostileInput, `flood-${index}`)
      totalEffectCount += effects.length

      expect(hasAnyValencedKind(effects)).toBe(false)
      expect(effects.every((effect) => effect.kind === 'npc_response_effect_candidate')).toBe(true)
    }

    // Bounded: at most one candidate per turn (npc_response_effect_candidate only,
    // since no promptId is ever supplied in this flood).
    expect(totalEffectCount).toBeLessThanOrEqual(floodSize)
  })
})
