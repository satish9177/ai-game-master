import { describe, expect, it } from 'vitest'
import { DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION } from './contracts'
import type { DialogueSemanticEvent } from './contracts'
import {
  parseDialogueSemanticEvent,
  validateDialogueSemanticEvent,
} from './validate'

function validEvent(overrides: Partial<DialogueSemanticEvent> = {}): DialogueSemanticEvent {
  return {
    schemaVersion: DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
    eventId: 'dialogue-event-1',
    kind: 'npc_responded',
    actor: 'npc',
    target: 'player',
    scope: {
      worldId: 'world-1',
      sessionId: 'session-1',
      roomId: 'room-1',
      npcId: 'npc-1',
    },
    provenance: {
      classifier: 'deterministic-local',
      promptId: 'ask-help',
      turnIndex: 3,
    },
    confidence: 'high',
    ...overrides,
  }
}

describe('validateDialogueSemanticEvent', () => {
  it('returns a parsed event for valid input', () => {
    const event = validEvent()
    expect(validateDialogueSemanticEvent(event)).toEqual(event)
    expect(parseDialogueSemanticEvent(event)).toEqual(event)
  })

  it('fails closed for unknown event kinds', () => {
    expect(validateDialogueSemanticEvent(validEvent({ kind: 'npc_granted_item' as never }))).toBeNull()
  })

  it('fails closed for extra fields', () => {
    expect(validateDialogueSemanticEvent({ ...validEvent(), text: 'raw dialogue text' })).toBeNull()
    expect(
      validateDialogueSemanticEvent(validEvent({ provenance: { classifier: 'deterministic-local', snippet: 'raw' } as never })),
    ).toBeNull()
  })

  it('fails closed for missing scope ids', () => {
    expect(validateDialogueSemanticEvent(validEvent({ scope: { sessionId: 'session-1', roomId: 'room-1' } as never }))).toBeNull()
    expect(validateDialogueSemanticEvent(validEvent({ scope: { worldId: 'world-1', roomId: 'room-1' } as never }))).toBeNull()
    expect(
      validateDialogueSemanticEvent(validEvent({ scope: { worldId: 'world-1', sessionId: 'session-1' } as never })),
    ).toBeNull()
  })

  it('fails closed for unknown classifier values', () => {
    expect(validateDialogueSemanticEvent(validEvent({ provenance: { classifier: 'llm' as never } }))).toBeNull()
  })

  it('fails closed for negative turnIndex', () => {
    expect(
      validateDialogueSemanticEvent(
        validEvent({ provenance: { classifier: 'deterministic-local', turnIndex: -1 } }),
      ),
    ).toBeNull()
  })

  it('does not throw on malformed input', () => {
    for (const input of [null, undefined, 'not an event', 7, [], { schemaVersion: 1 }]) {
      expect(() => validateDialogueSemanticEvent(input)).not.toThrow()
      expect(validateDialogueSemanticEvent(input)).toBeNull()
    }
  })

  it('rejects snippet/text/playerLine/npcText/providerText fields', () => {
    for (const field of ['snippet', 'text', 'playerLine', 'npcText', 'providerText']) {
      expect(validateDialogueSemanticEvent({ ...validEvent(), [field]: 'raw dialogue text' })).toBeNull()
    }
  })

  it('keeps provenance deterministic-local only', () => {
    expect(validateDialogueSemanticEvent(validEvent({ provenance: { classifier: 'deterministic-local' } }))).toEqual(
      validEvent({ provenance: { classifier: 'deterministic-local' } }),
    )
    expect(validateDialogueSemanticEvent(validEvent({ provenance: { classifier: 'deterministic-local-v2' as never } }))).toBeNull()
  })

  it('does not mutate input', () => {
    const input = validEvent()
    const before = structuredClone(input)

    expect(validateDialogueSemanticEvent(input)).toEqual(input)
    expect(input).toEqual(before)
  })
})
