import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { projectWorldState } from '../domain/world/applyEvent'
import { WorldEventSchema, type WorldEvent } from '../domain/world/events'
import type { Logger } from '../platform/logger/Logger'
import {
  awaitCommittedInteractionCallback,
  evaluateCommittedInteractionExitGuard,
} from '../renderer/committedInteractionPending'
import type { AppendEventResult, EventLogResult } from '../world-session/WorldSession'
import { coordinateCommittedInteractionFollowups } from './committedInteractionCoordinator'
import { navigateWithExitGate } from './gatedNavigation'
import type { NavigationResult } from './NavigationService'
import { runBeliefGatedNpcActionReaction } from './npcBeliefActionReaction'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'
const room = loadRoomSpec(throneRoom)
const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

function event(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-07-23T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })
}

function logThroughInteraction(): WorldEvent[] {
  return [
    event(1, 'session-started', {
      seed: {
        schemaVersion: 1,
        worldId: WORLD_ID,
        name: 'Test world',
        startingRoomId: 'throne-room',
        initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
      },
    }),
    event(2, 'item-added', {
      item: { itemId: 'gold-coin', name: 'Gold Coin', quantity: 1 },
    }),
    event(3, 'item-discovered', { roomId: 'throne-room', itemId: 'gold-coin' }),
    event(4, 'room-state-changed', {
      roomId: 'throne-room', flags: { 'interaction:offering-coffer': true },
    }),
  ]
}

function actionEvent(log: readonly WorldEvent[]): WorldEvent {
  return event(5, 'npc-action-committed', {
    npcId: 'herald-asha',
    roomId: 'throne-room',
    action: 'bar-exit',
    targetObjectId: 'north-door',
    ruleId: 'belief-gated-npc-action/bar-exit-on-witnessed-take@1',
    belief: {
      predicate: 'player-took-item',
      itemId: 'gold-coin',
      roomId: 'throne-room',
      confidence: 'high',
    },
    supportingEventIds: [log[2]!.eventId],
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe('interaction-turn navigation serialization', () => {
  it('T54 keeps the callback pending until the deferred action commit settles', async () => {
    const log = logThroughInteraction()
    const state = projectWorldState(log)
    const commit = deferred<AppendEventResult>()
    const session = {
      getEventLog: vi.fn<() => Promise<EventLogResult>>().mockResolvedValue({ ok: true, events: log }),
      commitNpcAction: vi.fn(() => commit.promise),
    }
    let resolved = false
    const callback = runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state,
      session: session as never,
      logger,
    }).then((result) => { resolved = true; return result })

    await Promise.resolve()
    await Promise.resolve()
    expect(session.commitNpcAction).toHaveBeenCalledTimes(1)
    expect(resolved).toBe(false)

    const action = actionEvent(log)
    log.push(action)
    const next = projectWorldState(log)
    commit.resolve({ ok: true, state: next, event: action })
    await expect(callback).resolves.toEqual({ status: 'committed', state: next, event: action })
    expect(log).toHaveLength(5)

    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(appSource).toMatch(/const\s+handleCommittedInteractionEvents\s*=\s*useCallback\(async/)
    expect(appSource).toMatch(/await\s+coordinateCommittedInteractionFollowups\s*\(/)
  })

  it('T55 sees npc-barred after the committed-interaction callback resolves', async () => {
    const log = logThroughInteraction()
    const state = projectWorldState(log)
    const action = actionEvent(log)
    const next = projectWorldState([...log, action])
    const session = {
      getEventLog: async () => ({ ok: true, events: log }) as EventLogResult,
      commitNpcAction: async () => ({ ok: true, state: next, event: action }) as AppendEventResult,
    }
    await runBeliefGatedNpcActionReaction({
      enabled: true, sessionId: SESSION_ID, room, state, session: session as never, logger,
    })

    const navigate = vi.fn<() => Promise<NavigationResult>>()
      .mockResolvedValue({ status: 'rejected', reason: 'unknown-room' })
    await expect(navigateWithExitGate({
      sessionId: SESSION_ID,
      fromRoomId: 'throne-room',
      toRoomId: 'ruined-safehouse',
      demoQuestEnabled: false,
      npcActionEnabled: true,
      npcActionRoom: room,
      getWorldState: async () => ({ ok: true, state: next }),
      navigate,
    })).resolves.toEqual({ status: 'rejected', reason: 'npc-barred' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('T56 RoomViewer uses the tested guard decision while an interaction is in flight', () => {
    expect(evaluateCommittedInteractionExitGuard(1)).toEqual({
      blocked: true,
      message: 'Wait — something is still happening here.',
    })

    const roomViewerSource = readFileSync(new URL('../renderer/RoomViewer.tsx', import.meta.url), 'utf8')
    expect(roomViewerSource).toMatch(
      /evaluateCommittedInteractionExitGuard\s*\(\s*committedInteractionInFlightRef\.current\s*,?\s*\)/,
    )
    expect(roomViewerSource).toMatch(/setNavigationMessage\s*\(\s*exitGuard\.message\s*\)/)
  })

  it('T56a keeps navigation blocked until both overlapping callbacks settle', async () => {
    const inFlight = { current: 0 }
    const first = deferred<void>()
    const second = deferred<void>()
    const firstCallback = awaitCommittedInteractionCallback(inFlight, () => first.promise)
    const secondCallback = awaitCommittedInteractionCallback(inFlight, () => second.promise)

    expect(inFlight.current).toBe(2)
    expect(evaluateCommittedInteractionExitGuard(inFlight.current).blocked).toBe(true)

    first.resolve()
    await firstCallback
    expect(inFlight.current).toBe(1)
    expect(evaluateCommittedInteractionExitGuard(inFlight.current).blocked).toBe(true)

    second.resolve()
    await secondCallback
    expect(inFlight.current).toBe(0)
    expect(evaluateCommittedInteractionExitGuard(inFlight.current)).toEqual({ blocked: false })
  })

  it('T57 releases the guard and propagates a real callback rejection to RoomViewer catch handling', async () => {
    const inFlight = { current: 0 }
    const marker = new Error('callback rejected')
    const rejection = awaitCommittedInteractionCallback(inFlight, async () => {
      throw marker
    })
    const roomViewerCatch = vi.fn()

    await rejection.catch(roomViewerCatch)

    expect(roomViewerCatch).toHaveBeenCalledWith(marker)
    expect(inFlight.current).toBe(0)
    expect(evaluateCommittedInteractionExitGuard(inFlight.current)).toEqual({ blocked: false })
    const roomViewerSource = readFileSync(new URL('../renderer/RoomViewer.tsx', import.meta.url), 'utf8')
    expect(roomViewerSource).toMatch(
      /await\s+awaitCommittedInteractionCallback\s*\([\s\S]*?\.catch\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?interaction resolution threw/,
    )
  })

  it('T58 real coordinator does not await unresolved memory promotion', async () => {
    const promotion = deferred<void>()
    const next = projectWorldState([...logThroughInteraction(), actionEvent(logThroughInteraction())])
    const promoteInteractionMemories = vi.fn(() => promotion.promise)
    const runReaction = vi.fn(async () => ({
      status: 'committed' as const,
      state: next,
      event: actionEvent(logThroughInteraction()),
    }))
    const refreshDerivedViews = vi.fn()

    await expect(coordinateCommittedInteractionFollowups({
      promoteInteractionMemories,
      runBeliefGatedNpcActionReaction: runReaction,
      refreshDerivedViews,
    })).resolves.toBeUndefined()

    expect(promoteInteractionMemories).toHaveBeenCalledTimes(1)
    expect(runReaction).toHaveBeenCalledTimes(1)
    expect(refreshDerivedViews).toHaveBeenCalledWith(next)
  })

  it('T58a real coordinator refreshes derived views only for a committed result', async () => {
    const refreshDerivedViews = vi.fn()
    const inFlight = { current: 0 }
    await awaitCommittedInteractionCallback(inFlight, () =>
      coordinateCommittedInteractionFollowups({
        promoteInteractionMemories: async () => undefined,
        runBeliefGatedNpcActionReaction: async () => ({
          status: 'refused', reason: 'already-acted',
        }),
        refreshDerivedViews,
      }))
    expect(refreshDerivedViews).not.toHaveBeenCalled()
    expect(inFlight.current).toBe(0)
    expect(evaluateCommittedInteractionExitGuard(inFlight.current)).toEqual({ blocked: false })
  })
})
