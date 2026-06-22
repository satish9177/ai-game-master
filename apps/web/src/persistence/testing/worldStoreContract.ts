import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorldStore } from '../../domain/ports/WorldStore'
import { applyEvent } from '../../domain/world/applyEvent'
import { WorldEventSchema } from '../../domain/world/events'
import type { SessionStartedEvent, WorldEvent } from '../../domain/world/events'
import type { WorldState } from '../../domain/world/worldState'

/**
 * A reusable behavioral contract for the `WorldStore` port (ADR-0018). It mirrors
 * the `InMemoryWorldStore` behaviors by intent — it does NOT import
 * `world-session/`, so the persistence import wall stays intact. Fixtures are
 * built straight from domain primitives (`applyEvent`, the event schema), which
 * is all the persistence layer is allowed to depend on.
 */

export type StoreContext = { store: WorldStore; cleanup: () => void }

const WORLD_ID = '00000000-0000-4000-8000-0000000000a1'
const SESSION_ID = '00000000-0000-4000-8000-0000000000b1'

function canonSeed(worldId = WORLD_ID) {
  return {
    schemaVersion: 1 as const,
    worldId,
    name: 'Contract World',
    startingRoomId: 'start-room',
    initialPlayer: {
      health: { current: 8, max: 10 },
      status: [] as string[],
      inventory: [{ itemId: 'water', name: 'Water', quantity: 2 }],
    },
  }
}

export function sessionStartedEvent(
  sessionId: string,
  worldId = WORLD_ID,
  occurredAt = '2026-06-22T10:00:00.000Z',
): SessionStartedEvent {
  const event = WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: randomUUID(),
    sessionId,
    seq: 1,
    occurredAt,
    type: 'session-started',
    payload: { seed: canonSeed(worldId) },
  })
  if (event.type !== 'session-started') throw new Error('session event narrowing failed')
  return event
}

export function healthChangedEvent(
  sessionId: string,
  seq: number,
  delta: number,
  occurredAt = `2026-06-22T10:00:${String(seq).padStart(2, '0')}.000Z`,
): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: randomUUID(),
    sessionId,
    seq,
    occurredAt,
    type: 'health-changed',
    payload: { delta },
  })
}

/** Create a started session in `store`, returning its first snapshot. */
export async function seedSession(
  store: WorldStore,
  sessionId = SESSION_ID,
  worldId = WORLD_ID,
): Promise<WorldState> {
  const firstEvent = sessionStartedEvent(sessionId, worldId)
  const snapshot = applyEvent(null, firstEvent)
  const created = await store.createSession({ sessionId, worldId, firstEvent, snapshot })
  if (!created.ok) throw new Error(`seedSession failed: ${created.error.code}`)
  return snapshot
}

export function runWorldStoreContract(makeStore: () => StoreContext): void {
  describe('WorldStore contract', () => {
    let ctx: StoreContext
    beforeEach(() => {
      ctx = makeStore()
    })
    afterEach(() => {
      ctx.cleanup()
    })

    it('createSession persists the seeded projection as the snapshot', async () => {
      const snapshot = await seedSession(ctx.store)
      const stored = await ctx.store.getSnapshot(SESSION_ID)
      expect(stored).toEqual(snapshot)
      const events = await ctx.store.listEvents(SESSION_ID)
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('session-started')
    })

    it('createSession on a taken id returns already-exists', async () => {
      await seedSession(ctx.store)
      const duplicate = await ctx.store.createSession({
        sessionId: SESSION_ID,
        worldId: WORLD_ID,
        firstEvent: sessionStartedEvent(SESSION_ID),
        snapshot: applyEvent(null, sessionStartedEvent(SESSION_ID)),
      })
      expect(duplicate).toEqual({ ok: false, error: { code: 'already-exists' } })
    })

    it('commit appends the event and bumps the snapshot revision', async () => {
      const snapshot = await seedSession(ctx.store)
      const event = healthChangedEvent(SESSION_ID, 2, -3)
      const next = applyEvent(snapshot, event)
      const committed = await ctx.store.commit({
        sessionId: SESSION_ID,
        expectedRevision: snapshot.revision,
        event,
        snapshot: next,
      })
      expect(committed).toEqual({ ok: true })

      const stored = await ctx.store.getSnapshot(SESSION_ID)
      expect(stored?.revision).toBe(2)
      expect(stored?.player.health.current).toBe(5)
      expect((await ctx.store.listEvents(SESSION_ID)).map((e) => e.seq)).toEqual([1, 2])
    })

    it('commit with a stale expectedRevision returns conflict and writes nothing', async () => {
      const snapshot = await seedSession(ctx.store)
      const first = healthChangedEvent(SESSION_ID, 2, -1)
      await ctx.store.commit({
        sessionId: SESSION_ID,
        expectedRevision: snapshot.revision,
        event: first,
        snapshot: applyEvent(snapshot, first),
      })

      // A second writer still holding revision 1 races: stale CAS → conflict.
      const stale = healthChangedEvent(SESSION_ID, 2, -1)
      const result = await ctx.store.commit({
        sessionId: SESSION_ID,
        expectedRevision: 1,
        event: stale,
        snapshot: applyEvent(snapshot, stale),
      })
      expect(result).toEqual({ ok: false, error: { code: 'conflict' } })
      expect((await ctx.store.listEvents(SESSION_ID)).map((e) => e.seq)).toEqual([1, 2])
      expect((await ctx.store.getSnapshot(SESSION_ID))?.revision).toBe(2)
    })

    it('commit on a missing session returns not-found', async () => {
      const missing = '00000000-0000-4000-8000-0000000000c9'
      const event = healthChangedEvent(missing, 2, -1)
      const snapshot = applyEvent(applyEvent(null, sessionStartedEvent(missing)), event)
      const result = await ctx.store.commit({
        sessionId: missing,
        expectedRevision: 1,
        event,
        snapshot,
      })
      expect(result).toEqual({ ok: false, error: { code: 'not-found' } })
    })

    it('restoreSession bulk-loads a validated log; a second restore is already-exists', async () => {
      const firstEvent = sessionStartedEvent(SESSION_ID)
      const snap1 = applyEvent(null, firstEvent)
      const second = healthChangedEvent(SESSION_ID, 2, -2)
      const snap2 = applyEvent(snap1, second)
      const log = [firstEvent, second]

      const restored = await ctx.store.restoreSession({ sessionId: SESSION_ID, log, snapshot: snap2 })
      expect(restored).toEqual({ ok: true })
      expect((await ctx.store.listEvents(SESSION_ID)).map((e) => e.seq)).toEqual([1, 2])
      expect((await ctx.store.getSnapshot(SESSION_ID))?.revision).toBe(2)

      const again = await ctx.store.restoreSession({ sessionId: SESSION_ID, log, snapshot: snap2 })
      expect(again).toEqual({ ok: false, error: { code: 'already-exists' } })
    })

    it('listEvents orders by seq and honors sinceSeq', async () => {
      const snapshot = await seedSession(ctx.store)
      let current = snapshot
      for (let seq = 2; seq <= 4; seq++) {
        const event = healthChangedEvent(SESSION_ID, seq, -1)
        const next = applyEvent(current, event)
        await ctx.store.commit({
          sessionId: SESSION_ID,
          expectedRevision: current.revision,
          event,
          snapshot: next,
        })
        current = next
      }
      expect((await ctx.store.listEvents(SESSION_ID)).map((e) => e.seq)).toEqual([1, 2, 3, 4])
      expect(
        (await ctx.store.listEvents(SESSION_ID, { sinceSeq: 2 })).map((e) => e.seq),
      ).toEqual([3, 4])
    })

    it('getSnapshot is null and listEvents empty for an unknown session', async () => {
      expect(await ctx.store.getSnapshot('00000000-0000-4000-8000-0000000000ff')).toBeNull()
      expect(await ctx.store.listEvents('00000000-0000-4000-8000-0000000000ff')).toEqual([])
    })
  })
}
