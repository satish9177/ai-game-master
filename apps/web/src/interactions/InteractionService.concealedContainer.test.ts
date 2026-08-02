import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { Logger } from '../platform/logger/Logger'
import { projectWorldState } from '../domain/world/applyEvent'
import { WorldEventSchema } from '../domain/world/events'
import type { WorldEvent } from '../domain/world/events'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import { InteractionService } from './InteractionService'

const SESSION_ID = '00000000-0000-4000-8000-000000000002'

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

const event = (seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent =>
  WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-08-02T10:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })

const start = event(1, 'session-started', {
  seed: {
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000001',
    name: 'Concealed container test world',
    startingRoomId: 'heralds-hall',
    initialPlayer: { health: { current: 10, max: 10 }, status: [], inventory: [] },
  },
})

const offstageTruth = event(2, 'offstage-item-taken', {
  roomId: 'heralds-hall',
  containerId: 'offering-coffer',
  itemId: 'gold-coin',
  actorId: 'night-porter',
  ruleId: 'false-belief/offstage-removal@1',
  concealed: true,
})

describe('InteractionService concealedContainer', () => {
  it('does not award or discover an item removed by authoritative offstage truth', async () => {
    const store = new InMemoryWorldStore()
    const log = [start, offstageTruth]
    const snapshot = projectWorldState(log)
    expect(await store.restoreSession({ sessionId: SESSION_ID, log, snapshot }))
      .toEqual({ ok: true })
    const clock: Clock = { now: () => '2026-08-02T10:00:03.000Z' }
    const idGenerator: IdGenerator = {
      newId: () => '00000000-0000-4000-8000-000000000099',
    }
    const session = new WorldSession(store, clock, idGenerator, logger)
    const service = new InteractionService(session, logger)

    const result = await service.resolve({
      sessionId: SESSION_ID,
      effect: {
        kind: 'take-item',
        item: { itemId: 'gold-coin', name: 'Gold Coin', quantity: 1 },
      },
      ref: 'offering-coffer',
    })

    expect(result).toMatchObject({ status: 'already-resolved', outcome: { kind: 'nothing' } })
    expect('state' in result && result.state.inventory).toEqual([])
    const afterLog = await store.listEvents(SESSION_ID)
    expect(afterLog).toEqual(log)
    expect(afterLog.some((entry) => entry.type === 'item-added')).toBe(false)
    expect(afterLog.some((entry) => entry.type === 'item-discovered')).toBe(false)
  })
})
