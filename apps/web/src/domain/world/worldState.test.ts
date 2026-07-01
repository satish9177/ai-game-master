import { describe, expect, it } from 'vitest'
import { WorldCommandSchema, WorldEventSchema } from './events'
import { CanonSeedSchema, InventoryItemSchema, WorldStateSchema } from './worldState'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const EVENT_ID = '00000000-0000-4000-8000-000000000003'
const OCCURRED_AT = '2026-06-22T10:00:00.000Z'

const canon = {
  schemaVersion: 1,
  worldId: WORLD_ID,
  name: 'The Ashen March',
  startingRoomId: 'gatehouse',
  initialPlayer: { health: { current: 8, max: 10 } },
}

const startEvent = {
  schemaVersion: 1,
  eventId: EVENT_ID,
  sessionId: SESSION_ID,
  seq: 1,
  occurredAt: OCCURRED_AT,
  type: 'session-started',
  payload: { seed: canon },
}

const snapshot = {
  schemaVersion: 1,
  worldId: WORLD_ID,
  sessionId: SESSION_ID,
  currentRoomId: 'gatehouse',
  player: { health: { current: 8, max: 10 }, status: [] },
  inventory: [],
  roomStates: { gatehouse: { visited: true } },
  revision: 1,
  updatedAt: OCCURRED_AT,
}

describe('world schemas', () => {
  it('parses canon defaults and valid neutral JSON data', () => {
    expect(CanonSeedSchema.parse(canon).initialPlayer).toEqual({
      health: { current: 8, max: 10 },
      status: [],
      inventory: [],
    })
    expect(InventoryItemSchema.parse({ itemId: 'water', name: 'Water', quantity: 1 }))
      .toEqual({ itemId: 'water', name: 'Water', quantity: 1 })
    expect(WorldStateSchema.parse(snapshot)).toEqual(snapshot)
  })

  it('rejects invalid health, inventory, ids, timestamps, and duplicate set values', () => {
    expect(CanonSeedSchema.safeParse({ ...canon, worldId: 'not-a-uuid' }).success).toBe(false)
    expect(CanonSeedSchema.safeParse({
      ...canon,
      initialPlayer: { health: { current: 11, max: 10 } },
    }).success).toBe(false)
    expect(InventoryItemSchema.safeParse({ itemId: 'x', name: 'X', quantity: 0 }).success)
      .toBe(false)
    expect(WorldStateSchema.safeParse({
      ...snapshot,
      player: { ...snapshot.player, status: ['poisoned', 'poisoned'] },
    }).success).toBe(false)
    expect(WorldStateSchema.safeParse({ ...snapshot, updatedAt: '2026-06-22' }).success)
      .toBe(false)
    expect(WorldStateSchema.safeParse({
      ...snapshot,
      inventory: [
        { itemId: 'x', name: 'X', quantity: 1 },
        { itemId: 'x', name: 'X again', quantity: 1 },
      ],
    }).success).toBe(false)
  })

  it('parses the existing seven event variants plus item-discovered, and matching commands', () => {
    const envelope = {
      schemaVersion: 1,
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      seq: 2,
      occurredAt: OCCURRED_AT,
    }
    const events = [
      startEvent,
      { ...envelope, type: 'moved-to-room', payload: { toRoomId: 'yard' } },
      { ...envelope, type: 'item-added', payload: { item: { itemId: 'x', name: 'X', quantity: 1 } } },
      { ...envelope, type: 'item-discovered', payload: { roomId: 'yard', itemId: 'x' } },
      { ...envelope, type: 'item-removed', payload: { itemId: 'x', quantity: 1 } },
      { ...envelope, type: 'health-changed', payload: { delta: -1, reason: 'fall' } },
      { ...envelope, type: 'status-changed', payload: { status: 'cold', op: 'add' } },
      { ...envelope, type: 'room-state-changed', payload: { roomId: 'yard', flags: { open: true } } },
    ]
    expect(events.every((event) => WorldEventSchema.safeParse(event).success)).toBe(true)

    const commands = events.slice(1).map((event) => ({
      schemaVersion: 1,
      type: event.type,
      ...(event.payload as object),
    }))
    expect(commands.every((command) => WorldCommandSchema.safeParse(command).success)).toBe(true)
    expect(WorldCommandSchema.safeParse({ schemaVersion: 1, type: 'session-started' }).success)
      .toBe(false)
  })

  it('rejects malformed item-discovered event and command shapes', () => {
    const envelope = {
      schemaVersion: 1,
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      seq: 2,
      occurredAt: OCCURRED_AT,
      type: 'item-discovered',
    }

    expect(WorldEventSchema.safeParse({
      ...envelope,
      payload: { roomId: 'yard' },
    }).success).toBe(false)
    expect(WorldEventSchema.safeParse({
      ...envelope,
      payload: { itemId: 'key' },
    }).success).toBe(false)
    expect(WorldEventSchema.safeParse({
      ...envelope,
      payload: { roomId: 'yard', itemId: 'key', extra: true },
    }).success).toBe(false)
    expect(WorldCommandSchema.safeParse({
      schemaVersion: 1,
      type: 'item-discovered',
      roomId: 'yard',
    }).success).toBe(false)
    expect(WorldCommandSchema.safeParse({
      schemaVersion: 1,
      type: 'item-discovered',
      itemId: 'key',
    }).success).toBe(false)
  })

  it('requires schemaVersion 1 on persisted events and snapshots', () => {
    expect(WorldEventSchema.safeParse({ ...startEvent, schemaVersion: 2 }).success).toBe(false)
    expect(WorldStateSchema.safeParse({ ...snapshot, schemaVersion: 2 }).success).toBe(false)
  })
})
