import { describe, expect, it, vi } from 'vitest'
import { DialogueSemanticEventSchema } from './contracts'
import type {
  DialogueSemanticEventKind,
  DialogueSemanticEventScope,
} from './contracts'
import {
  classifyDialogueTurn,
  type DialogueTurnClassificationInput,
} from './classify'
import { validateDialogueSemanticEvent } from './validate'

const RESERVED_KINDS: DialogueSemanticEventKind[] = [
  'player_shared_claim',
  'player_promised_help',
  'player_threatened_npc',
  'npc_warned_player',
  'npc_revealed_rumor',
  'npc_refused_request',
  'npc_acknowledged_memory',
]

const scope: DialogueSemanticEventScope = {
  worldId: 'world-1',
  sessionId: 'session-1',
  roomId: 'room-1',
  npcId: 'npc-1',
}

function input(overrides: Partial<DialogueTurnClassificationInput> = {}): DialogueTurnClassificationInput {
  return {
    scope,
    hasNpcReply: false,
    makeEventId: (kind, indexInTurn) => `event-${kind}-${indexInTurn}`,
    ...overrides,
  }
}

describe('classifyDialogueTurn', () => {
  it('emits player_asked_question for promptId ask-room', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-room' }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventId: 'event-player_asked_question-0',
      kind: 'player_asked_question',
      actor: 'player',
      target: 'npc',
      scope,
      provenance: {
        classifier: 'deterministic-local',
        promptId: 'ask-room',
      },
      confidence: 'high',
    })
  })

  it('emits player_asked_question for promptId ask-help', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-help' }))

    expect(events.map((event) => event.kind)).toEqual(['player_asked_question'])
    expect(events[0]?.provenance.promptId).toBe('ask-help')
  })

  it('emits no player_asked_question when promptId is absent', () => {
    const events = classifyDialogueTurn(input())

    expect(events.some((event) => event.kind === 'player_asked_question')).toBe(false)
  })

  it('emits no player_asked_question for unknown prompt ids', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-lore' }))

    expect(events.some((event) => event.kind === 'player_asked_question')).toBe(false)
  })

  it('emits npc_responded when hasNpcReply is true', () => {
    const events = classifyDialogueTurn(input({ hasNpcReply: true }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventId: 'event-npc_responded-0',
      kind: 'npc_responded',
      actor: 'npc',
      target: 'player',
      scope,
      provenance: {
        classifier: 'deterministic-local',
      },
      confidence: 'high',
    })
    expect(events[0]?.provenance.promptId).toBeUndefined()
  })

  it('emits no npc_responded when hasNpcReply is false', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-room', hasNpcReply: false }))

    expect(events.some((event) => event.kind === 'npc_responded')).toBe(false)
  })

  it('returns both events when question prompt and NPC reply are present', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-room', hasNpcReply: true }))

    expect(events.map((event) => event.kind)).toEqual(['player_asked_question', 'npc_responded'])
  })

  it('calls makeEventId once per emitted event with increasing indexInTurn', () => {
    const makeEventId = vi.fn((kind: DialogueSemanticEventKind, indexInTurn: number) => `fixed-${kind}-${indexInTurn}`)

    const events = classifyDialogueTurn(input({ promptId: 'ask-help', hasNpcReply: true, makeEventId }))

    expect(events).toHaveLength(2)
    expect(makeEventId).toHaveBeenCalledTimes(2)
    expect(makeEventId).toHaveBeenNthCalledWith(1, 'player_asked_question', 0)
    expect(makeEventId).toHaveBeenNthCalledWith(2, 'npc_responded', 1)
  })

  it('returns an empty array when neither condition is true', () => {
    expect(classifyDialogueTurn(input())).toEqual([])
  })

  it('copies scope including npcId unchanged to every emitted event', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-room', hasNpcReply: true }))

    for (const event of events) {
      expect(event.scope).toEqual(scope)
    }
  })

  it('includes turnIndex when supplied and omits it when absent', () => {
    const withTurnIndex = classifyDialogueTurn(input({ promptId: 'ask-room', turnIndex: 4 }))
    const withoutTurnIndex = classifyDialogueTurn(input({ promptId: 'ask-room' }))

    expect(withTurnIndex[0]?.provenance.turnIndex).toBe(4)
    expect(withoutTurnIndex[0]?.provenance.turnIndex).toBeUndefined()
  })

  it('validates every emitted event', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-room', hasNpcReply: true, turnIndex: 2 }))

    for (const event of events) {
      expect(DialogueSemanticEventSchema.safeParse(event).success).toBe(true)
      expect(validateDialogueSemanticEvent(event)).toEqual(event)
    }
  })

  it('never emits reserved Slice 2 kinds', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-room', hasNpcReply: true }))
    const kinds = events.map((event) => event.kind)

    for (const reservedKind of RESERVED_KINDS) {
      expect(kinds).not.toContain(reservedKind)
    }
  })

  it('does not accept or inspect free-text fields', () => {
    const proseShapedInput = {
      ...input({ promptId: 'ask-room', hasNpcReply: true }),
      playerLine: 'do not classify this as a promise',
      npcText: 'do not classify this as a warning',
      providerText: 'do not classify this as a rumor',
    } as DialogueTurnClassificationInput

    const events = classifyDialogueTurn(proseShapedInput)

    expect(events.map((event) => event.kind)).toEqual(['player_asked_question', 'npc_responded'])
    for (const event of events) {
      expect(RESERVED_KINDS).not.toContain(event.kind)
    }
  })

  it('fails closed when a constructed candidate is invalid', () => {
    const events = classifyDialogueTurn(input({ promptId: 'ask-room', makeEventId: () => '' }))

    expect(events).toEqual([])
  })
})
