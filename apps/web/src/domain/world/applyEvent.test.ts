import { describe, expect, it } from 'vitest'
import { applyEvent, projectWorldState } from './applyEvent'
import { WorldEventSchema } from './events'
import type { WorldEvent } from './events'
import { jsonDeepEqual } from './jsonDeepEqual'
import { validateEventLog } from './validateEventLog'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'

const event = (seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent =>
  WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-06-22T10:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })

const start = event(1, 'session-started', {
  seed: {
    schemaVersion: 1,
    worldId: WORLD_ID,
    name: 'World content stays in the event, not logs',
    startingRoomId: 'gatehouse',
    initialPlayer: {
      health: { current: 8, max: 10 },
      status: ['cold'],
      inventory: [{ itemId: 'water', name: 'Water', quantity: 2 }],
    },
  },
})

describe('world projection', () => {
  it('applies every event type with the v0 transition semantics', () => {
    const log = [
      start,
      event(2, 'moved-to-room', { fromRoomId: 'gatehouse', toRoomId: 'yard' }),
      event(3, 'item-added', { item: { itemId: 'water', name: 'Water', quantity: 3 } }),
      event(4, 'item-added', { item: { itemId: 'key', name: 'Iron Key', quantity: 1 } }),
      event(5, 'item-removed', { itemId: 'water', quantity: 99 }),
      event(6, 'health-changed', { delta: 99, reason: 'rested' }),
      event(7, 'health-changed', { delta: -99 }),
      event(8, 'status-changed', { status: 'cold', op: 'add' }),
      event(9, 'status-changed', { status: 'cold', op: 'clear' }),
      event(10, 'room-state-changed', {
        roomId: 'yard',
        visited: false,
        flags: { gateOpen: true },
      }),
      event(11, 'room-state-changed', { roomId: 'yard', flags: { alarmed: true } }),
    ]

    const state = projectWorldState(log)
    expect(projectWorldState(log.slice(0, 6)).player.health).toEqual({ current: 10, max: 10 })
    expect(state.currentRoomId).toBe('yard')
    expect(state.roomStates.yard).toEqual({
      visited: false,
      flags: { gateOpen: true, alarmed: true },
    })
    expect(state.inventory).toEqual([{ itemId: 'key', name: 'Iron Key', quantity: 1 }])
    expect(state.player.health).toEqual({ current: 0, max: 10 })
    expect(state.player.status).toEqual([])
    expect(state.revision).toBe(11)
    expect(state.updatedAt).toBe('2026-06-22T10:00:11.000Z')
  })

  it('is deterministic and does not mutate the state, event, seed, or log', () => {
    const initial = applyEvent(null, start)
    const added = event(2, 'item-added', {
      item: { itemId: 'water', name: 'Water', quantity: 1 },
    })
    const initialBefore = structuredClone(initial)
    const eventBefore = structuredClone(added)
    const log = [start, added]
    const logBefore = structuredClone(log)

    expect(applyEvent(initial, added)).toEqual(applyEvent(initial, added))
    expect(initial).toEqual(initialBefore)
    expect(added).toEqual(eventBefore)
    expect(projectWorldState(log)).toEqual(projectWorldState(log))
    expect(log).toEqual(logBefore)
  })

  it('rejects reducer programmer errors for inconsistent start placement', () => {
    expect(() => applyEvent(null, event(2, 'health-changed', { delta: -1 }))).toThrow()
    expect(() => applyEvent(applyEvent(null, start), start)).toThrow()
    expect(() => projectWorldState([])).toThrow()
  })
})

describe('validateEventLog', () => {
  it('accepts a gapless log and reports stable codes for malformed logs', () => {
    const second = event(2, 'health-changed', { delta: -1 })
    expect(validateEventLog([start, second])).toEqual({ ok: true, issues: [] })
    expect(validateEventLog([
      start,
      { ...second, sessionId: '00000000-0000-4000-8000-000000000099' },
    ]).issues).toEqual([{ code: 'session-id-mismatch' }])
    expect(validateEventLog([]).issues).toEqual([{ code: 'empty-log' }])
    expect(validateEventLog([second]).issues).toEqual([
      { code: 'missing-session-started' },
      { code: 'seq-gap' },
    ])
    expect(validateEventLog([start, { ...start, seq: 1 }]).issues).toEqual([
      { code: 'multiple-session-started' },
      { code: 'non-monotonic-seq' },
      { code: 'seq-gap' },
    ])
  })
})

describe('jsonDeepEqual', () => {
  it('compares nested JSON structurally without depending on object key order', () => {
    expect(jsonDeepEqual(
      { a: 1, nested: { x: [true, null, 'v'], y: 2 } },
      { nested: { y: 2, x: [true, null, 'v'] }, a: 1 },
    )).toBe(true)
    expect(jsonDeepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(jsonDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})
