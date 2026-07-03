import { describe, expect, it, vi } from 'vitest'
import {
  loadEventConsequenceJournal,
  readEventConsequenceJournalEnabled,
  type EventConsequenceJournalRawEnv,
} from './eventConsequenceJournalSeam'
import { buildEventConsequenceJournal } from '../domain/journal/eventConsequenceJournal'
import type { EventLogResult } from '../world-session/WorldSession'
import type { WorldEvent } from '../domain/world/events'
import { WorldSession } from '../world-session/WorldSession'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { SystemClock } from '../platform/system/clock'
import { UuidGenerator } from '../platform/system/idGenerator'
import type { Logger } from '../platform/logger/Logger'

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger
  },
}

const SESSION_ID = '00000000-0000-4000-8000-000000000002'

function movedToRoom(seq: number): WorldEvent {
  return {
    schemaVersion: 1,
    eventId: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: '2026-01-01T00:00:00.000Z',
    type: 'moved-to-room',
    payload: {
      fromRoomId: 'FROM_ROOM_ID_SENTINEL_XYZ',
      toRoomId: 'TO_ROOM_ID_SENTINEL_XYZ',
    },
  }
}

function okLog(events: WorldEvent[]): EventLogResult {
  return { ok: true, events }
}

function read(env: EventConsequenceJournalRawEnv) {
  return readEventConsequenceJournalEnabled(env)
}

describe('readEventConsequenceJournalEnabled flag gate', () => {
  it('enables only when the flag is exactly the string "true"', () => {
    expect(read({ VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS: 'true' })).toBe(true)
  })

  it('stays disabled when unset or any non-exact value (default OFF)', () => {
    expect(read({})).toBe(false)
    expect(read({ VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS: 'false' })).toBe(false)
    expect(read({ VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS: ' TRUE ' })).toBe(false)
    expect(read({ VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS: '1' })).toBe(false)
  })
})

describe('loadEventConsequenceJournal - flag OFF preserves existing behavior', () => {
  it('returns null and never reads the event log when the flag is OFF', async () => {
    const getEventLog = vi.fn(async () => okLog([movedToRoom(2)]))

    const view = await loadEventConsequenceJournal({
      enabled: false,
      sessionId: SESSION_ID,
      getEventLog,
    })

    expect(view).toBeNull()
    expect(getEventLog).not.toHaveBeenCalled()
  })
})

describe('loadEventConsequenceJournal - flag ON uses the event-derived view', () => {
  it('projects the fetched events through the Slice-1 projector when events are available', async () => {
    const events = [movedToRoom(1), movedToRoom(2)]
    const getEventLog = vi.fn(async () => okLog(events))

    const view = await loadEventConsequenceJournal({
      enabled: true,
      sessionId: SESSION_ID,
      getEventLog,
    })

    expect(getEventLog).toHaveBeenCalledOnce()
    expect(getEventLog).toHaveBeenCalledWith(SESSION_ID)
    expect(view).toEqual(buildEventConsequenceJournal(events))
    expect(view?.entries).toHaveLength(2)
  })

  it('yields a safe empty view (not null) when the log has no qualifying events', async () => {
    const getEventLog = vi.fn(async () => okLog([]))

    const view = await loadEventConsequenceJournal({
      enabled: true,
      sessionId: SESSION_ID,
      getEventLog,
    })

    // A successful projection with no entries still "succeeds and yields a
    // JournalView" (D1) — it is a non-null override, not a fallback.
    expect(view).not.toBeNull()
    expect(view?.entries).toEqual([])
  })
})

describe('loadEventConsequenceJournal - async failure falls back', () => {
  it('returns null when the log read reports not-found (session unavailable)', async () => {
    const getEventLog = vi.fn(
      async (): Promise<EventLogResult> => ({ ok: false, error: { code: 'not-found', message: 'x' } }),
    )

    const view = await loadEventConsequenceJournal({
      enabled: true,
      sessionId: SESSION_ID,
      getEventLog,
    })

    expect(view).toBeNull()
  })

  it('returns null (does not throw) when the log read rejects', async () => {
    const getEventLog = vi.fn(async (): Promise<EventLogResult> => {
      throw new Error('fixed-test-error')
    })

    await expect(
      loadEventConsequenceJournal({ enabled: true, sessionId: SESSION_ID, getEventLog }),
    ).resolves.toBeNull()
  })
})

describe('loadEventConsequenceJournal - read-only over a real WorldSession', () => {
  it('appends no events and mutates no state; only getEventLog is used', async () => {
    const store = new InMemoryWorldStore()
    const session = new WorldSession(store, new SystemClock(), new UuidGenerator(), noopLogger)

    const started = await session.startSession({
      schemaVersion: 1,
      worldId: '00000000-0000-4000-8000-000000000001',
      name: 'read-only-check',
      startingRoomId: 'room-a',
      initialPlayer: { health: { current: 75, max: 100 }, status: [], inventory: [] },
    })
    if (!started.ok) throw new Error('expected session start')
    const sessionId = started.state.sessionId

    // Produce a couple of real events through the authoritative append path.
    const moved = await session.move(sessionId, 'room-b', started.state.revision, 'room-a')
    if (!moved.ok) throw new Error('expected move')
    const harmed = await session.changeHealth(sessionId, -5, moved.state.revision, 'trap')
    if (!harmed.ok) throw new Error('expected health change')

    const before = await session.getEventLog(sessionId)
    if (!before.ok) throw new Error('expected event log')
    const beforeCount = before.events.length
    const beforeRevision = harmed.state.revision

    const view = await loadEventConsequenceJournal({
      enabled: true,
      sessionId,
      getEventLog: (id) => session.getEventLog(id),
    })

    const after = await session.getEventLog(sessionId)
    if (!after.ok) throw new Error('expected event log')
    const afterState = await session.getWorldState(sessionId)
    if (!afterState.ok) throw new Error('expected world state')

    // No new events, no revision bump: the seam is strictly read-only.
    expect(after.events.length).toBe(beforeCount)
    expect(afterState.state.revision).toBe(beforeRevision)
    // It still produced the event-derived view from the existing log.
    expect(view).toEqual(buildEventConsequenceJournal(after.events))
  })
})

describe('loadEventConsequenceJournal - no raw event content leaks', () => {
  it('never echoes content-bearing payload fields into the journal view', async () => {
    const events = [movedToRoom(1)]
    const getEventLog = vi.fn(async () => okLog(events))

    const view = await loadEventConsequenceJournal({
      enabled: true,
      sessionId: SESSION_ID,
      getEventLog,
    })

    const text = (view?.entries ?? []).map((entry) => entry.text).join('\n')
    for (const sentinel of ['FROM_ROOM_ID_SENTINEL_XYZ', 'TO_ROOM_ID_SENTINEL_XYZ', 'moved-to-room']) {
      expect(text).not.toContain(sentinel)
    }
  })
})
