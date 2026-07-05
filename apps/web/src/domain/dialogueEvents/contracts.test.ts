import { describe, expect, it } from 'vitest'
import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  DialogueSemanticEventKindSchema,
  DialogueSemanticEventSchema,
} from './contracts'
import type { DialogueSemanticEvent, DialogueSemanticEventKind } from './contracts'

const EVENT_KINDS: DialogueSemanticEventKind[] = [
  'player_asked_question',
  'player_shared_claim',
  'player_promised_help',
  'player_threatened_npc',
  'npc_responded',
  'npc_warned_player',
  'npc_revealed_rumor',
  'npc_refused_request',
  'npc_acknowledged_memory',
  'player_apologized',
  'player_thanked_npc',
  'player_insulted_npc',
  'player_refused_request',
  'npc_offered_help',
]

function validEvent(overrides: Partial<DialogueSemanticEvent> = {}): DialogueSemanticEvent {
  return {
    schemaVersion: DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
    eventId: 'dialogue-event-1',
    kind: 'player_asked_question',
    actor: 'player',
    target: 'npc',
    scope: {
      worldId: 'world-1',
      sessionId: 'session-1',
      roomId: 'room-1',
      npcId: 'npc-1',
    },
    provenance: {
      classifier: 'deterministic-local',
      promptId: 'ask-room',
      turnIndex: 0,
    },
    confidence: 'medium',
    ...overrides,
  }
}

describe('DialogueSemanticEventSchema', () => {
  it('parses a valid event and round-trips it unchanged', () => {
    const event = validEvent()
    expect(DialogueSemanticEventSchema.parse(event)).toEqual(event)
  })

  it('pins schemaVersion to 1', () => {
    expect(DialogueSemanticEventSchema.safeParse(validEvent()).success).toBe(true)
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ schemaVersion: 2 as never })).success).toBe(false)
  })

  it('accepts every closed event kind', () => {
    for (const kind of EVENT_KINDS) {
      expect(DialogueSemanticEventKindSchema.safeParse(kind).success).toBe(true)
      expect(DialogueSemanticEventSchema.safeParse(validEvent({ kind })).success).toBe(true)
    }
  })

  it('rejects unknown event kinds and other enum values', () => {
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ kind: 'player_cast_spell' as never })).success).toBe(
      false,
    )
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ actor: 'system' as never })).success).toBe(false)
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ target: 'object' as never })).success).toBe(false)
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ confidence: 'certain' as never })).success).toBe(false)
  })

  it('requires non-empty event and scope ids while npcId stays optional', () => {
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ eventId: '' })).success).toBe(false)
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: { ...validEvent().scope, worldId: '' } })).success).toBe(
      false,
    )
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: { ...validEvent().scope, sessionId: '' } })).success).toBe(
      false,
    )
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: { ...validEvent().scope, roomId: '' } })).success).toBe(
      false,
    )
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: { ...validEvent().scope, npcId: '' } })).success).toBe(
      false,
    )

    const scopeWithoutNpc: DialogueSemanticEvent['scope'] = {
      worldId: validEvent().scope.worldId,
      sessionId: validEvent().scope.sessionId,
      roomId: validEvent().scope.roomId,
    }
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: scopeWithoutNpc })).success).toBe(true)
  })

  it('requires worldId, sessionId, and roomId in scope', () => {
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: { sessionId: 's', roomId: 'r' } as never })).success).toBe(
      false,
    )
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: { worldId: 'w', roomId: 'r' } as never })).success).toBe(
      false,
    )
    expect(DialogueSemanticEventSchema.safeParse(validEvent({ scope: { worldId: 'w', sessionId: 's' } as never })).success).toBe(
      false,
    )
  })

  it('accepts deterministic-local provenance only', () => {
    expect(
      DialogueSemanticEventSchema.safeParse(validEvent({ provenance: { classifier: 'deterministic-local' } })).success,
    ).toBe(true)
    expect(
      DialogueSemanticEventSchema.safeParse(validEvent({ provenance: { classifier: 'llm' as never } })).success,
    ).toBe(false)
  })

  it('rejects negative or non-integer turnIndex', () => {
    expect(
      DialogueSemanticEventSchema.safeParse(
        validEvent({ provenance: { classifier: 'deterministic-local', turnIndex: -1 } }),
      ).success,
    ).toBe(false)
    expect(
      DialogueSemanticEventSchema.safeParse(
        validEvent({ provenance: { classifier: 'deterministic-local', turnIndex: 1.5 } }),
      ).success,
    ).toBe(false)
  })

  it('rejects unknown extra keys at every structured boundary', () => {
    expect(DialogueSemanticEventSchema.safeParse({ ...validEvent(), extra: true }).success).toBe(false)
    expect(
      DialogueSemanticEventSchema.safeParse(validEvent({ scope: { ...validEvent().scope, extra: true } as never }))
        .success,
    ).toBe(false)
    expect(
      DialogueSemanticEventSchema.safeParse(
        validEvent({ provenance: { classifier: 'deterministic-local', raw: 'secret text' } as never }),
      ).success,
    ).toBe(false)
  })

  it('does not accept free-text or snippet fields', () => {
    for (const field of ['snippet', 'text', 'playerLine', 'npcText', 'providerText']) {
      expect(DialogueSemanticEventSchema.safeParse({ ...validEvent(), [field]: 'raw dialogue text' }).success).toBe(
        false,
      )
    }
  })
})
