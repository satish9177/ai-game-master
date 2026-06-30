import { describe, expect, it } from 'vitest'

import { WorldCommandSchema, WorldEventSchema } from '../world/events'
import type { WorldEvent } from '../world/events'
import { WORLD_SCHEMA_VERSION } from '../world/worldState'
import { validateRoomMemoryDraft } from './roomFirewall'
import {
  DEFAULT_MIN_IMPORTANCE,
  PROMOTION_CONFIDENCE,
  PROMOTION_ROOM_KIND,
  PROMOTION_SOURCE,
  ROOM_STATE_MEMORY_TEXT,
  dedupePromotions,
  importanceFor,
  promoteWorldEvent,
  promotionDedupeKey,
} from './promotion'
import type { PromotedMemory } from './promotion'

const SESSION_ID = '33333333-3333-4333-8333-333333333333'
const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_EVENT_ID = '22222222-2222-4222-8222-222222222222'
const WORLD_ID = 'world-1'
const ROOM_ID = 'old-library'

function roomStateChanged(
  payload: { roomId: string; visited?: boolean; flags?: Record<string, boolean> },
  envelope?: { eventId?: string; sessionId?: string; seq?: number },
): WorldEvent {
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    eventId: envelope?.eventId ?? EVENT_ID,
    sessionId: envelope?.sessionId ?? SESSION_ID,
    seq: envelope?.seq ?? 1,
    occurredAt: '2026-06-30T00:00:00.000Z',
    type: 'room-state-changed',
    payload,
  }
}

/** Build a non-room event for ignore-by-type tests; the mapper never reads these payloads. */
function eventOfType(type: WorldEvent['type'], payload: unknown = {}): WorldEvent {
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    eventId: EVENT_ID,
    sessionId: SESSION_ID,
    seq: 1,
    occurredAt: '2026-06-30T00:00:00.000Z',
    type,
    payload,
  } as WorldEvent
}

const durableEvent = roomStateChanged({ roomId: ROOM_ID, flags: { burned: true } })

describe('promoteWorldEvent', () => {
  it('promotes a durable room-state change (non-empty flags) to a room memory', () => {
    const result = promoteWorldEvent(durableEvent, { worldId: WORLD_ID })

    expect(result).not.toBeNull()
    expect(result?.target).toBe('room')
    expect(result?.importance).toBe(3)
    expect(result?.input).toEqual({
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      kind: PROMOTION_ROOM_KIND,
      source: PROMOTION_SOURCE,
      text: ROOM_STATE_MEMORY_TEXT,
      confidence: PROMOTION_CONFIDENCE,
    })
  })

  it('promotes when visited is set alongside non-empty flags', () => {
    const event = roomStateChanged({ roomId: ROOM_ID, visited: true, flags: { opened: true } })
    expect(promoteWorldEvent(event, { worldId: WORLD_ID })).not.toBeNull()
  })

  it('ignores a room-state change that only toggles visited (transient presence)', () => {
    const event = roomStateChanged({ roomId: ROOM_ID, visited: true })
    expect(promoteWorldEvent(event, { worldId: WORLD_ID })).toBeNull()
  })

  it('ignores a room-state change with an empty flags map', () => {
    const event = roomStateChanged({ roomId: ROOM_ID, flags: {} })
    expect(promoteWorldEvent(event, { worldId: WORLD_ID })).toBeNull()
  })

  it('ignores item-added in v0 (no trustworthy "acquired here" signal)', () => {
    expect(promoteWorldEvent(eventOfType('item-added'), { worldId: WORLD_ID })).toBeNull()
  })

  it('ignores the remaining mechanical / non-promotable event types', () => {
    const ignored: WorldEvent['type'][] = [
      'item-removed',
      'moved-to-room',
      'health-changed',
      'status-changed',
      'session-started',
    ]
    for (const type of ignored) {
      expect(promoteWorldEvent(eventOfType(type), { worldId: WORLD_ID })).toBeNull()
    }
  })

  it('scopes the draft: roomId from the payload, sessionId from the event, worldId from ctx (trimmed)', () => {
    const event = roomStateChanged(
      { roomId: 'crypt', flags: { collapsed: true } },
      { sessionId: 'session-xyz' },
    )
    const result = promoteWorldEvent(event, { worldId: '  world-7  ' })

    expect(result?.input.roomId).toBe('crypt')
    expect(result?.input.sessionId).toBe('session-xyz')
    expect(result?.input.worldId).toBe('world-7')
  })

  it('assigns source="game" and the backend confidence constant (never from an LLM)', () => {
    const result = promoteWorldEvent(durableEvent, { worldId: WORLD_ID })
    expect(result?.input.source).toBe('game')
    expect(result?.input.confidence).toBe('medium')
    expect(PROMOTION_CONFIDENCE).toBe('medium')
  })

  it('produces id/payload-free memory text within the 280-char bound', () => {
    const event = roomStateChanged({ roomId: ROOM_ID, flags: { bloodStained: true } })
    const result = promoteWorldEvent(event, { worldId: WORLD_ID })
    const text = result?.input.text ?? ''

    expect(text.length).toBeGreaterThan(0)
    expect(text.length).toBeLessThanOrEqual(280)
    expect(text).not.toContain(ROOM_ID)
    expect(text).not.toContain('bloodStained')
    expect(text).not.toContain(SESSION_ID)
  })

  it('returns null when worldId is missing/blank', () => {
    expect(promoteWorldEvent(durableEvent, { worldId: '   ' })).toBeNull()
  })

  it('returns null when the payload roomId is blank', () => {
    const event = roomStateChanged({ roomId: '   ', flags: { opened: true } })
    expect(promoteWorldEvent(event, { worldId: WORLD_ID })).toBeNull()
  })

  it('honours the minImportance gate', () => {
    expect(promoteWorldEvent(durableEvent, { worldId: WORLD_ID, minImportance: 5 })).toBeNull()
    expect(promoteWorldEvent(durableEvent, { worldId: WORLD_ID, minImportance: 3 })).not.toBeNull()
  })

  it('is pure: does not mutate inputs and is referentially stable', () => {
    const event = Object.freeze(roomStateChanged({ roomId: ROOM_ID, flags: { opened: true } }))
    const ctx = Object.freeze({ worldId: WORLD_ID })

    const a = promoteWorldEvent(event, ctx)
    const b = promoteWorldEvent(event, ctx)
    expect(a).toEqual(b)
  })

  it('output feeds RoomMemoryService.remember unchanged (validateRoomMemoryDraft ok)', () => {
    const result = promoteWorldEvent(durableEvent, { worldId: WORLD_ID })
    expect(result).not.toBeNull()
    const validated = validateRoomMemoryDraft(result!.input)
    expect(validated.ok).toBe(true)
  })

  it('structural firewall: the promoted draft is NOT a WorldEvent/WorldCommand', () => {
    const result = promoteWorldEvent(durableEvent, { worldId: WORLD_ID })
    expect(result).not.toBeNull()
    expect(WorldEventSchema.safeParse(result!.input).success).toBe(false)
    expect(WorldCommandSchema.safeParse(result!.input).success).toBe(false)
  })
})

describe('importanceFor', () => {
  it('scores per the promotion table', () => {
    expect(importanceFor(roomStateChanged({ roomId: ROOM_ID, flags: { burned: true } }))).toBe(3)
    expect(importanceFor(roomStateChanged({ roomId: ROOM_ID, visited: true }))).toBe(1)
    expect(importanceFor(eventOfType('item-added'))).toBe(1)
    expect(importanceFor(eventOfType('item-removed'))).toBe(1)
    expect(importanceFor(eventOfType('moved-to-room'))).toBe(1)
    expect(importanceFor(eventOfType('health-changed'))).toBe(1)
    expect(importanceFor(eventOfType('status-changed'))).toBe(1)
    expect(importanceFor(eventOfType('session-started'))).toBe(0)
  })

  it('the default threshold is 3', () => {
    expect(DEFAULT_MIN_IMPORTANCE).toBe(3)
  })
})

describe('promotionDedupeKey', () => {
  it('is deterministic and ties the key to the event identity (eventId)', () => {
    const key = promotionDedupeKey(durableEvent, { worldId: WORLD_ID })
    expect(key).toBe(promotionDedupeKey(durableEvent, { worldId: WORLD_ID }))
    expect(key).toContain(EVENT_ID)
    expect(key).toContain(WORLD_ID)
    expect(key).toContain(SESSION_ID)
  })

  it('distinguishes two different events for the same room (no wrongful collapse)', () => {
    const a = roomStateChanged({ roomId: ROOM_ID, flags: { opened: true } }, { eventId: EVENT_ID })
    const b = roomStateChanged(
      { roomId: ROOM_ID, flags: { burned: true } },
      { eventId: OTHER_EVENT_ID },
    )
    expect(promotionDedupeKey(a, { worldId: WORLD_ID })).not.toBe(
      promotionDedupeKey(b, { worldId: WORLD_ID }),
    )
  })
})

describe('dedupePromotions', () => {
  const promote = (event: WorldEvent): PromotedMemory => {
    const result = promoteWorldEvent(event, { worldId: WORLD_ID })
    if (result === null) throw new Error('expected a promotion')
    return result
  }

  it('collapses the same committed event promoted twice (idempotency)', () => {
    const item = promote(durableEvent)
    const { kept, keys } = dedupePromotions([item, item])
    expect(kept).toHaveLength(1)
    expect(keys).toHaveLength(1)
  })

  it('keeps two distinct events for the same room', () => {
    const a = promote(roomStateChanged({ roomId: ROOM_ID, flags: { opened: true } }, { eventId: EVENT_ID }))
    const b = promote(
      roomStateChanged({ roomId: ROOM_ID, flags: { burned: true } }, { eventId: OTHER_EVENT_ID }),
    )
    expect(dedupePromotions([a, b]).kept).toHaveLength(2)
  })

  it('drops items whose key is already in seenKeys', () => {
    const item = promote(durableEvent)
    const { kept } = dedupePromotions([item], [item.dedupeKey])
    expect(kept).toHaveLength(0)
  })

  it('does not mutate the inputs', () => {
    const item = promote(durableEvent)
    const items = Object.freeze([item])
    const seen = Object.freeze([] as string[])
    expect(() => dedupePromotions(items, seen)).not.toThrow()
  })
})
