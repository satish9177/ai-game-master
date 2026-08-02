import { describe, expect, it } from 'vitest'
import { interactionFlagKey as leafInteractionFlagKey } from '../interactions/interactionFlags'
import { interactionFlagKey as plannerInteractionFlagKey } from '../interactions/planInteraction'
import { InMemoryWorldStore } from '../../world-session/InMemoryWorldStore'
import { loadSaveGame, SaveGameService } from '../../world-session/saveGame'
import { applyEvent, projectWorldState } from './applyEvent'
import { WorldEventSchema } from './events'
import type { WorldEvent } from './events'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'

const logger: ConstructorParameters<typeof SaveGameService>[1] = {
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
    worldId: WORLD_ID,
    name: 'Concealed truth test world',
    startingRoomId: 'gatehouse',
    initialPlayer: {
      health: { current: 10, max: 10 },
      status: [],
      inventory: [{ itemId: 'water', name: 'Water', quantity: 1 }],
    },
  },
})

const existingRoomState = event(2, 'room-state-changed', {
  roomId: 'heralds-hall',
  visited: true,
  flags: { 'unrelated:open': true },
})

const offstageTruth = event(3, 'offstage-item-taken', {
  roomId: 'heralds-hall',
  containerId: 'offering-coffer',
  itemId: 'gold-coin',
  actorId: 'night-porter',
  ruleId: 'false-belief/offstage-removal@1',
  concealed: true,
})

describe('offstageTruth world projection', () => {
  it('sets the established interaction flag while preserving all other state', () => {
    const before = projectWorldState([start, existingRoomState])
    const eventBefore = structuredClone(offstageTruth)
    const after = applyEvent(before, offstageTruth)

    expect(after.roomStates['heralds-hall']).toEqual({
      visited: true,
      flags: {
        'unrelated:open': true,
        'interaction:offering-coffer': true,
      },
    })
    expect(after.roomStates.gatehouse).toEqual(before.roomStates.gatehouse)
    expect(after.inventory).toEqual(before.inventory)
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    expect(Object.keys(after)).toHaveLength(9)
    expect(offstageTruth).toEqual(eventBefore)
  })

  it('is deterministic under replay and projection-idempotent under duplicate application', () => {
    const log = [start, existingRoomState, offstageTruth]
    const firstReplay = projectWorldState(log)
    const secondReplay = projectWorldState(log)
    const before = projectWorldState(log.slice(0, 2))
    const once = applyEvent(before, offstageTruth)
    const twice = applyEvent(once, offstageTruth)

    expect(secondReplay).toEqual(firstReplay)
    expect(twice).toEqual(once)
    expect(firstReplay.roomStates['heralds-hall']?.flags?.['interaction:offering-coffer'])
      .toBe(true)
  })

  it('keeps the planner re-export byte-compatible with the leaf helper', () => {
    const cases: ReadonlyArray<readonly [string | undefined, string | undefined]> = [
      [undefined, 'offering-coffer'],
      ['authored:flag', 'ignored-ref'],
      [undefined, 'punctuation:/?#[]@!$&'],
      [undefined, ''],
      [undefined, undefined],
    ]

    for (const [explicitFlag, ref] of cases) {
      expect(plannerInteractionFlagKey(explicitFlag, ref))
        .toBe(leafInteractionFlagKey(explicitFlag, ref))
    }
    expect(plannerInteractionFlagKey(undefined, 'offering-coffer'))
      .toBe('interaction:offering-coffer')
  })
})

describe('offstageTruth save and load', () => {
  it('preserves the authoritative event and projected flag through save/load', async () => {
    const log = [start, existingRoomState, offstageTruth]
    const snapshot = projectWorldState(log)
    const eventBefore = structuredClone(offstageTruth)
    const sourceStore = new InMemoryWorldStore()
    expect(await sourceStore.restoreSession({ sessionId: SESSION_ID, log, snapshot }))
      .toEqual({ ok: true })

    const saved = await new SaveGameService(sourceStore, logger).saveSession(SESSION_ID)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const parsed = loadSaveGame(saved.json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.saveGame.log[2]).toEqual(offstageTruth)
    expect(parsed.saveGame.snapshot.roomStates['heralds-hall']?.flags)
      .toMatchObject({ 'interaction:offering-coffer': true })

    const restoredStore = new InMemoryWorldStore()
    expect(await new SaveGameService(restoredStore, logger).loadSession(saved.json))
      .toEqual({ ok: true, sessionId: SESSION_ID })
    expect(await restoredStore.getSnapshot(SESSION_ID)).toEqual(snapshot)
    expect(await restoredStore.listEvents(SESSION_ID)).toEqual(log)
    expect(offstageTruth).toEqual(eventBefore)
  })

  it('loads an old save without this event unchanged', () => {
    const log = [start]
    const original = JSON.stringify({
      schemaVersion: 1,
      seed: start.type === 'session-started' ? start.payload.seed : undefined,
      log,
      snapshot: projectWorldState(log),
    })
    const loaded = loadSaveGame(original)

    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(JSON.stringify(loaded.saveGame)).toBe(original)
  })
})
