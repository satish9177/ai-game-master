import { describe, expect, it } from 'vitest'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import { deriveNpcObservations } from './observationScope'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'
const scope = { npcId: 'herald-asha', npcRoomId: 'throne-room', itemId: 'gold-coin' }

function event(
  seq: number,
  type: WorldEvent['type'],
  payload: unknown,
): WorldEvent {
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

function started(startingRoomId = 'throne-room'): WorldEvent {
  return event(1, 'session-started', {
    seed: {
      schemaVersion: 1,
      worldId: WORLD_ID,
      name: 'Test world',
      startingRoomId,
      initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
    },
  })
}

function discovered(seq: number, roomId = 'throne-room', itemId = 'gold-coin'): WorldEvent {
  return event(seq, 'item-discovered', { roomId, itemId })
}

describe('deriveNpcObservations', () => {
  it('T1 emits exactly one in-scope observation', () => {
    expect(deriveNpcObservations([started(), discovered(2)], scope)).toEqual([{
      schemaVersion: 1,
      observerNpcId: 'herald-asha',
      kind: 'item-taken-from-room',
      roomId: 'throne-room',
      itemId: 'gold-coin',
      fidelity: 'full',
      sourceEventId: '30000000-0000-4000-8000-000000000002',
      sourceSeq: 2,
      occurredAt: '2026-01-01T00:00:02.000Z',
    }])
  })

  it('T2 emits only the closed observation fields', () => {
    const [observation] = deriveNpcObservations([started(), discovered(2)], scope)
    expect(Object.keys(observation!).sort()).toEqual([
      'fidelity',
      'itemId',
      'kind',
      'observerNpcId',
      'occurredAt',
      'roomId',
      'schemaVersion',
      'sourceEventId',
      'sourceSeq',
    ])
  })

  it('T3 ignores discovery in another room', () => {
    expect(deriveNpcObservations([started(), discovered(2, 'ruined-safehouse')], scope)).toEqual([])
  })

  it('T4 ignores an event while the player is elsewhere', () => {
    expect(deriveNpcObservations([
      started('ruined-safehouse'),
      discovered(2),
    ], scope)).toEqual([])
  })

  it('T5 ignores all non-discovery event kinds', () => {
    const log = [
      started(),
      event(2, 'item-added', { item: { itemId: 'gold-coin', name: 'Gold Coin', quantity: 1 } }),
      event(3, 'health-changed', { delta: -1 }),
      event(4, 'status-changed', { status: 'hurt', op: 'add' }),
      event(5, 'moved-to-room', { fromRoomId: 'throne-room', toRoomId: 'ruined-safehouse' }),
      event(6, 'room-state-changed', { roomId: 'throne-room', flags: { inspected: true } }),
      event(7, 'meaningful-object-applied', {
        roomId: 'throne-room', objectId: 'page', family: 'document', action: 'read', state: 'read',
      }),
    ]
    expect(deriveNpcObservations(log, scope)).toEqual([])
  })

  it('T6 is repeatable and does not mutate frozen input', () => {
    const log = Object.freeze([started(), discovered(2)])
    Object.freeze(log[0])
    Object.freeze(log[1])
    const first = deriveNpcObservations(log, scope)
    expect(deriveNpcObservations(log, scope)).toEqual(first)
    expect(log.map((entry) => entry.seq)).toEqual([1, 2])
  })

  it('T7 orders two scoped observations by source sequence', () => {
    const result = deriveNpcObservations([started(), discovered(3), discovered(2)], scope)
    expect(result.map((observation) => observation.sourceSeq)).toEqual([2, 3])
  })

  it('T7a ignores a different item in the observer room', () => {
    expect(deriveNpcObservations([started(), discovered(2, 'throne-room', 'royal-writ')], scope)).toEqual([])
  })

  it('T7b emits only the scoped item among other room discoveries', () => {
    const result = deriveNpcObservations([
      started(),
      discovered(2, 'throne-room', 'royal-writ'),
      discovered(3),
      discovered(4, 'throne-room', 'crown'),
    ], scope)
    expect(result).toHaveLength(1)
    expect(result[0]?.itemId).toBe('gold-coin')
  })
})
