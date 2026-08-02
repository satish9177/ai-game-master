import { describe, expect, it } from 'vitest'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import {
  deriveDefeasibleObservations,
  type DefeasibleObservationScope,
} from './observationScopeV2'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'
const ROOM_ID = 'fixture-room'
const scope: DefeasibleObservationScope = {
  npcId: 'fixture-npc',
  npcRoomId: ROOM_ID,
  itemId: 'fixture-item',
  containerId: 'fixture-container',
  attentionObjectIds: ['fixture-container', 'attention-object'],
  initialContents: 'present',
}

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

function started(startingRoomId = ROOM_ID): WorldEvent {
  return event(1, 'session-started', {
    seed: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      name: 'Fixture world',
      startingRoomId,
      initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
    },
  })
}

describe('deriveDefeasibleObservations', () => {
  it('FB-S3-03 preserves the existing direct-witness observation shape byte for byte', () => {
    const discovery = event(2, 'item-discovered', { roomId: ROOM_ID, itemId: 'fixture-item' })
    const direct = deriveDefeasibleObservations([started(), discovery], scope)
      .find((observation) => observation.kind === 'item-taken-from-room')

    expect(direct).toEqual({
      schemaVersion: 1,
      observerNpcId: 'fixture-npc',
      kind: 'item-taken-from-room',
      roomId: ROOM_ID,
      itemId: 'fixture-item',
      fidelity: 'full',
      sourceEventId: discovery.eventId,
      sourceSeq: 2,
      occurredAt: discovery.occurredAt,
    })
  })

  it('FB-S3-04 derives each container read from its consumed prefix, not HEAD', () => {
    const theft = event(2, 'offstage-item-taken', {
      roomId: ROOM_ID,
      containerId: 'fixture-container',
      itemId: 'fixture-item',
      actorId: 'concealed-actor',
      ruleId: 'fixture-rule',
      concealed: true,
    })
    const attention = event(3, 'room-state-changed', {
      roomId: ROOM_ID,
      flags: { 'interaction:attention-object': true },
    })
    const reads = deriveDefeasibleObservations([started(), theft, attention], scope)
      .filter((observation) => observation.kind === 'container-state-read')

    expect(reads.map((observation) => observation.contents)).toEqual(['present', 'absent'])
    expect(reads.map((observation) => observation.sourceSeq)).toEqual([1, 3])
  })

  it('FB-S3-05 conceals the offstage event and cites only the later attention event', () => {
    const theft = event(2, 'offstage-item-taken', {
      roomId: ROOM_ID,
      containerId: 'fixture-container',
      itemId: 'fixture-item',
      actorId: 'concealed-actor',
      ruleId: 'concealed-rule',
      concealed: true,
    })
    const attention = event(3, 'room-state-changed', {
      roomId: ROOM_ID,
      flags: { 'interaction:attention-object': true },
    })
    const observations = deriveDefeasibleObservations([started(), theft, attention], scope)
    const serialized = JSON.stringify(observations)
    const absentRead = observations.find(
      (observation) => observation.kind === 'container-state-read'
        && observation.contents === 'absent',
    )

    expect(observations.some((observation) => observation.sourceSeq === theft.seq)).toBe(false)
    expect(absentRead?.sourceEventId).toBe(attention.eventId)
    expect(serialized).not.toContain(theft.eventId)
    expect(serialized).not.toContain('concealed-actor')
    expect(serialized).not.toContain('offstage-item-taken')
  })

  it('FB-S3-06 N2b emits multiple spans but at most one distinct runtime actor', () => {
    const observations = deriveDefeasibleObservations([
      started(),
      event(2, 'moved-to-room', { fromRoomId: ROOM_ID, toRoomId: 'other-room' }),
      event(3, 'moved-to-room', { fromRoomId: 'other-room', toRoomId: ROOM_ID }),
    ], scope)
    const spans = observations.filter(
      (observation) => observation.kind === 'actor-co-present',
    )

    expect(spans).toHaveLength(2)
    expect(new Set(spans.map((span) => span.actorId)).size).toBeLessThanOrEqual(1)
    expect(spans.every((span) => span.actorId === 'player')).toBe(true)
  })

  it('FB-S3-07 preserves authoritative emission order without a final sort', () => {
    const observations = deriveDefeasibleObservations([
      started(),
      event(2, 'room-state-changed', {
        roomId: ROOM_ID,
        flags: { 'interaction:attention-object': true },
      }),
    ], scope)

    expect(observations.map((observation) => observation.sourceSeq)).toEqual([1, 1, 2])
  })
})
