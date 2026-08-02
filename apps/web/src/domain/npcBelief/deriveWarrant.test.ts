import { describe, expect, it } from 'vitest'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import { deriveWarrant } from './deriveWarrant'
import {
  deriveDefeasibleObservations,
  type DefeasibleNpcObservation,
} from './observationScopeV2'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'
const ROOM_ID = 'fixture-room'
const NPC_ID = 'fixture-npc'
const ITEM_ID = 'fixture-item'

function observationId(value: number): string {
  return `30000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}

function read(
  seq: number,
  contents: 'present' | 'absent',
): DefeasibleNpcObservation {
  return {
    schemaVersion: 1,
    observerNpcId: NPC_ID,
    kind: 'container-state-read',
    fidelity: 'partial',
    roomId: ROOM_ID,
    containerId: 'fixture-container',
    contents,
    missing: ['actor', 'action'],
    sourceEventId: observationId(seq),
    sourceSeq: seq,
    occurredAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
  }
}

function span(
  actorId: string,
  fromSeq = 1,
  toSeq = 4,
  sourceSeq = fromSeq,
): DefeasibleNpcObservation {
  return {
    schemaVersion: 1,
    observerNpcId: NPC_ID,
    kind: 'actor-co-present',
    fidelity: 'full',
    roomId: ROOM_ID,
    actorId,
    fromSeq,
    toSeq,
    sourceEventId: observationId(sourceSeq + 20),
    sourceSeq,
    occurredAt: `2026-01-01T00:00:${String(sourceSeq).padStart(2, '0')}.000Z`,
  }
}

function derive(observations: readonly DefeasibleNpcObservation[]) {
  return deriveWarrant({ observations, holderNpcId: NPC_ID, roomId: ROOM_ID, itemId: ITEM_ID })
}

function worldEvent(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: observationId(seq),
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })
}

describe('deriveWarrant', () => {
  it('FB-S3-08 abstains with no observations', () => {
    expect(derive([])).toEqual({ status: 'abstained', reason: 'no-observations' })
  })

  it('FB-S3-09 abstains when the before premise is missing', () => {
    expect(derive([read(3, 'absent')])).toEqual({
      status: 'abstained', reason: 'missing-before-premise',
    })
  })

  it('FB-S3-10 Arm A abstains when the after premise is missing', () => {
    expect(derive([read(1, 'present'), read(2, 'present'), span('player')])).toEqual({
      status: 'abstained', reason: 'missing-after-premise',
    })
  })

  it('FB-S3-11 A2 abstains for two distinct holder-scoped candidates', () => {
    expect(derive([
      read(1, 'present'),
      read(4, 'absent'),
      span('player'),
      span('second-actor', 1, 4, 2),
    ])).toEqual({ status: 'abstained', reason: 'ambiguous-candidates' })
  })

  it('FB-S3-12 A3 abstains when no single co-presence span covers the interval', () => {
    expect(derive([
      read(1, 'present'),
      read(4, 'absent'),
      span('player', 1, 2),
      span('player', 3, 4, 3),
    ])).toEqual({ status: 'abstained', reason: 'no-candidates' })
  })

  it('FB-S3-13 derives the ordered inferred V2 warrant and holder-only provenance', () => {
    const foreign = { ...read(2, 'present'), observerNpcId: 'other-npc' }
    const result = derive([read(1, 'present'), foreign, read(4, 'absent'), span('player')])

    expect(result.status).toBe('warranted')
    if (result.status !== 'warranted') return
    expect(result.derived).toEqual({
      beliefVersion: 2,
      confidence: 'low',
      itemId: ITEM_ID,
      supportingEventIds: [observationId(1), observationId(4), observationId(21)],
      lastUpdatedSeq: 4,
      warrant: {
        ruleId: 'sole-copresent-candidate@1',
        premises: [
          {
            id: 'p1-before', kind: 'observed',
            observationEventIds: [observationId(1)], defeasible: false,
          },
          {
            id: 'p2-after', kind: 'observed',
            observationEventIds: [observationId(4)], defeasible: false,
          },
          {
            id: 'p3-sole-candidate', kind: 'observed',
            observationEventIds: [observationId(21)], defeasible: true,
          },
          {
            id: 'p4-no-alternate-access', kind: 'default',
            observationEventIds: [], defeasible: true,
          },
        ],
        defeasiblePremiseIds: ['p3-sole-candidate', 'p4-no-alternate-access'],
      },
    })
  })

  it('FB-S3-14 gives direct witness V1 precedence when an Arm-T log also forms a partial pair', () => {
    const log = [
      worldEvent(1, 'session-started', {
        seed: {
          schemaVersion: 1,
          worldId: WORLD_ID,
          name: 'Fixture world',
          startingRoomId: ROOM_ID,
          initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
        },
      }),
      worldEvent(2, 'item-discovered', { roomId: ROOM_ID, itemId: ITEM_ID }),
      worldEvent(3, 'room-state-changed', {
        roomId: ROOM_ID,
        flags: { 'interaction:fixture-container': true },
      }),
    ]
    const observations = deriveDefeasibleObservations(log, {
      npcId: NPC_ID,
      npcRoomId: ROOM_ID,
      itemId: ITEM_ID,
      containerId: 'fixture-container',
      attentionObjectIds: ['fixture-container'],
    })
    const result = derive(observations)

    expect(observations.some(
      (observation) => observation.kind === 'container-state-read'
        && observation.contents === 'absent',
    )).toBe(true)
    expect(result.status).toBe('warranted')
    if (result.status !== 'warranted') return
    expect(result.derived.beliefVersion).toBe(1)
    expect(result.derived.confidence).toBe('high')
    expect(result.derived.warrant).toEqual({
      ruleId: 'direct-witness@1',
      premises: [{
        id: 'p1-witnessed-take',
        kind: 'observed',
        observationEventIds: [observationId(2)],
        defeasible: false,
      }],
      defeasiblePremiseIds: [],
    })
  })
})
