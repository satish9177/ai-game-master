import { describe, expect, it } from 'vitest'
import { projectWorldState } from './applyEvent'
import { WorldEventSchema, type WorldEvent } from './events'
import { SaveGameSchema } from './saveGame'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'

function event(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID, seq, occurredAt: `2026-01-01T00:00:0${seq}.000Z`, type, payload,
  })
}

const seed = {
  schemaVersion: 1 as const, worldId: WORLD_ID, name: 'World', startingRoomId: 'room',
  initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
}
const started = event(1, 'session-started', { seed })

describe('false-belief event save schema compatibility', () => {
  it('still accepts an old save with no false-belief events unchanged', () => {
    const old = { schemaVersion: 1, seed, log: [started], snapshot: projectWorldState([started]) }
    expect(SaveGameSchema.parse(JSON.parse(JSON.stringify(old)))).toEqual(old)
  })

  it('round-trips all authority events in order with a false retracted action flag', () => {
    const offstage = event(2, 'offstage-item-taken', {
      roomId: 'room', containerId: 'container', itemId: 'item',
      actorId: 'concealed-actor', ruleId: 'truth', concealed: true,
    })
    const discovered = event(3, 'evidence-discovered', {
      roomId: 'room', evidenceId: 'evidence', sourceObjectId: 'source',
    })
    const committed = event(4, 'npc-action-committed', {
      npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
      ruleId: 'action', belief: {
        beliefSchemaVersion: 2, predicate: 'player-took-item', itemId: 'item',
        roomId: 'room', confidence: 'low', warrant: {
          ruleId: 'sole-copresent-candidate@1',
          premises: [{
            id: 'p4-no-alternate-access', kind: 'default',
            observationEventIds: [], defeasible: true,
          }],
          defeasiblePremiseIds: ['p4-no-alternate-access'],
        },
      },
      supportingEventIds: [started.eventId],
    })
    const presented = event(5, 'evidence-presented', {
      roomId: 'room', evidenceId: 'evidence', toNpcId: 'npc',
      presentationObjectId: 'presentation', discoveryEventId: discovered.eventId,
    })
    const retracted = event(6, 'npc-action-retracted', {
      npcId: 'npc', roomId: 'room', action: 'bar-exit', targetObjectId: 'exit',
      ruleId: 'retract', defeatedPremiseId: 'p4-no-alternate-access',
      evidenceId: 'evidence', supersedesEventId: committed.eventId,
      supportingEventIds: [presented.eventId, discovered.eventId],
    })
    const log = [started, offstage, discovered, committed, presented, retracted]
    const snapshot = projectWorldState(log)
    const saved = SaveGameSchema.parse(JSON.parse(JSON.stringify({
      schemaVersion: 1, seed, log, snapshot,
    })))
    expect(saved.log.map((entry) => entry.type)).toEqual(log.map((entry) => entry.type))
    expect(saved.snapshot.roomStates.room?.flags?.['npc-action:npc:bar-exit:exit'])
      .toBe(false)
    expect(projectWorldState(saved.log)).toEqual(saved.snapshot)
  })
})
