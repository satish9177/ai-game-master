import { describe, expect, it } from 'vitest'
import { applyEvent, projectWorldState } from './applyEvent'
import { WorldEventSchema, type WorldEvent } from './events'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'

function event(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })
}

const started = event(1, 'session-started', { seed: {
  schemaVersion: 1, worldId: WORLD_ID, name: 'World', startingRoomId: 'room',
  initialPlayer: { health: { current: 90, max: 100 }, status: ['steady'], inventory: [] },
} })
const committed = event(2, 'npc-action-committed', {
  npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
  ruleId: 'action-rule', belief: {
    predicate: 'player-took-item', itemId: 'item', roomId: 'room', confidence: 'high',
  }, supportingEventIds: [started.eventId],
})
const retracted = event(3, 'npc-action-retracted', {
  npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
  ruleId: 'retraction-rule', defeatedPremiseId: 'p4-no-alternate-access',
  evidenceId: 'evidence', supersedesEventId: committed.eventId,
  supportingEventIds: [started.eventId],
})

describe('npc-action-retracted projection', () => {
  it('sets the existing action flag false while preserving the complete state shape', () => {
    const before = projectWorldState([started, committed])
    before.roomStates.room!.flags = { ...before.roomStates.room!.flags, unrelated: true }
    before.roomStates.other = { visited: false, flags: { other: true } }
    const after = applyEvent(before, retracted)
    expect(after).toEqual({
      ...before,
      roomStates: {
        ...before.roomStates,
        room: {
          visited: true,
          flags: { unrelated: true, 'npc-action:npc:bar-exit:exit': false },
        },
      },
      revision: 3,
      updatedAt: retracted.occurredAt,
    })
  })

  it('is deterministic and idempotent at the action flag', () => {
    const once = projectWorldState([started, committed, retracted])
    const repeated = applyEvent(once, { ...retracted, seq: 4 })
    expect(repeated.roomStates.room?.flags?.['npc-action:npc:bar-exit:exit']).toBe(false)
    expect(applyEvent(once, { ...retracted, seq: 4 })).toEqual(repeated)
  })
})
