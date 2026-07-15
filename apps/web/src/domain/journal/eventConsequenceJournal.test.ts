import { describe, expect, it } from 'vitest'
import type { WorldEvent } from '../world/events'
import * as eventConsequenceJournalModule from './eventConsequenceJournal'
import {
  buildEventConsequenceJournal,
  buildMeaningfulObjectConsequenceJournal,
  mergeMeaningfulObjectConsequenceJournal,
} from './eventConsequenceJournal'

const CAP = 15

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const OCCURRED_AT = '2026-01-01T00:00:00.000Z'

function envelope(seq: number) {
  return {
    schemaVersion: 1 as const,
    eventId: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: OCCURRED_AT,
  }
}

// Builders produce fully-populated, schema-shaped events (content-bearing
// fields carry distinctive sentinels) so leak-guards exercise real payloads.
function sessionStarted(seq: number): WorldEvent {
  return {
    ...envelope(seq),
    type: 'session-started',
    payload: {
      seed: {
        schemaVersion: 1,
        worldId: WORLD_ID,
        title: 'SEED_TITLE_SENTINEL_XYZ',
        premise: 'SEED_PREMISE_SENTINEL_XYZ',
        tone: 'SEED_TONE_SENTINEL_XYZ',
      },
    },
  } as unknown as WorldEvent
}

function movedToRoom(seq: number): WorldEvent {
  return {
    ...envelope(seq),
    type: 'moved-to-room',
    payload: {
      fromRoomId: 'FROM_ROOM_ID_SENTINEL_XYZ',
      toRoomId: 'TO_ROOM_ID_SENTINEL_XYZ',
    },
  }
}

function itemAdded(seq: number): WorldEvent {
  return {
    ...envelope(seq),
    type: 'item-added',
    payload: {
      item: {
        itemId: 'ITEM_ID_SENTINEL_XYZ',
        name: 'ITEM_NAME_SENTINEL_XYZ',
        quantity: 1,
      },
    },
  }
}

function itemDiscovered(seq: number): WorldEvent {
  return {
    ...envelope(seq),
    type: 'item-discovered',
    payload: {
      roomId: 'ROOM_ID_SENTINEL_XYZ',
      itemId: 'ITEM_ID_SENTINEL_XYZ',
    },
  }
}

function itemRemoved(seq: number, quantity = 1): WorldEvent {
  return {
    ...envelope(seq),
    type: 'item-removed',
    payload: {
      itemId: 'ITEM_ID_SENTINEL_XYZ',
      quantity,
    },
  }
}

function healthChanged(seq: number, delta: number): WorldEvent {
  return {
    ...envelope(seq),
    type: 'health-changed',
    payload: {
      delta,
      reason: 'HEALTH_REASON_SENTINEL_XYZ',
    },
  }
}

function statusChanged(seq: number, op: 'add' | 'clear'): WorldEvent {
  return {
    ...envelope(seq),
    type: 'status-changed',
    payload: {
      status: 'STATUS_SENTINEL_XYZ',
      op,
    },
  }
}

function roomStateChanged(
  seq: number,
  flags: Record<string, boolean> | undefined,
  visited?: boolean,
): WorldEvent {
  return {
    ...envelope(seq),
    type: 'room-state-changed',
    payload: {
      roomId: 'ROOM_ID_SENTINEL_XYZ',
      ...(visited === undefined ? {} : { visited }),
      ...(flags === undefined ? {} : { flags }),
    },
  }
}

function texts(view: ReturnType<typeof buildEventConsequenceJournal>): string[] {
  return view.entries.map((entry) => entry.text)
}

function ids(view: ReturnType<typeof buildEventConsequenceJournal>): string[] {
  return view.entries.map((entry) => entry.id)
}

function allText(view: ReturnType<typeof buildEventConsequenceJournal>): string {
  return view.entries.map((entry) => entry.text).join('\n')
}

describe('buildEventConsequenceJournal - empty and defensive inputs', () => {
  it('empty log returns a safe empty journal view', () => {
    expect(buildEventConsequenceJournal([])).toEqual({
      journalId: 'event-consequence-journal',
      title: 'Consequences',
      entries: [],
    })
  })

  it('session-started-only log produces no entries', () => {
    const view = buildEventConsequenceJournal([sessionStarted(1)])
    expect(view.entries).toEqual([])
  })

  it('does not throw on unknown/unsupported event shapes', () => {
    const unknownEvent = {
      ...envelope(1),
      type: 'future-unknown-event',
      payload: { anything: 'RAW_SENTINEL_XYZ' },
    } as unknown as WorldEvent

    expect(() => buildEventConsequenceJournal([unknownEvent])).not.toThrow()
    expect(buildEventConsequenceJournal([unknownEvent]).entries).toEqual([])
  })
})

describe('buildEventConsequenceJournal - per-type mapping', () => {
  it('maps moved-to-room to a closed phrase', () => {
    expect(texts(buildEventConsequenceJournal([movedToRoom(1)]))).toEqual([
      'You pressed on to a new area.',
    ])
  })

  it('maps item-added to a closed phrase', () => {
    expect(texts(buildEventConsequenceJournal([itemAdded(1)]))).toEqual([
      'You gained something of use.',
    ])
  })

  it('maps item-discovered to a closed phrase', () => {
    expect(texts(buildEventConsequenceJournal([itemDiscovered(1)]))).toEqual([
      'You noticed something worth taking.',
    ])
  })

  it('maps item-removed to a closed phrase', () => {
    expect(texts(buildEventConsequenceJournal([itemRemoved(1)]))).toEqual([
      'You parted with something.',
    ])
  })

  it('splits health-changed by sign of delta', () => {
    expect(texts(buildEventConsequenceJournal([healthChanged(1, -5)]))).toEqual([
      'You took harm.',
    ])
    expect(texts(buildEventConsequenceJournal([healthChanged(1, 5)]))).toEqual([
      'You recovered some vigor.',
    ])
    expect(buildEventConsequenceJournal([healthChanged(1, 0)]).entries).toEqual([])
  })

  it('splits status-changed by op', () => {
    expect(texts(buildEventConsequenceJournal([statusChanged(1, 'add')]))).toEqual([
      'A new condition took hold.',
    ])
    expect(texts(buildEventConsequenceJournal([statusChanged(1, 'clear')]))).toEqual([
      'A condition lifted.',
    ])
  })

  it('adds a room-state entry only when any flag is true', () => {
    expect(
      texts(buildEventConsequenceJournal([roomStateChanged(1, { 'interaction:x': true })])),
    ).toEqual(['Your actions left a mark here.'])
  })

  it('skips room-state changes with no true flags (visited-only)', () => {
    expect(buildEventConsequenceJournal([roomStateChanged(1, undefined, true)]).entries).toEqual([])
    expect(
      buildEventConsequenceJournal([roomStateChanged(1, { 'interaction:x': false })]).entries,
    ).toEqual([])
  })
})

describe('buildEventConsequenceJournal - ordering, cap, and ids', () => {
  it('produces entries in seq-ascending (chronological) order', () => {
    const view = buildEventConsequenceJournal([
      movedToRoom(1),
      itemAdded(2),
      healthChanged(3, -1),
      statusChanged(4, 'clear'),
    ])

    expect(texts(view)).toEqual([
      'You pressed on to a new area.',
      'You gained something of use.',
      'You took harm.',
      'A condition lifted.',
    ])
    expect(ids(view)).toEqual(['evt-1', 'evt-2', 'evt-3', 'evt-4'])
  })

  it('keeps at most the cap of the most-recent qualifying entries', () => {
    const events: WorldEvent[] = []
    for (let seq = 1; seq <= CAP + 5; seq += 1) {
      events.push(movedToRoom(seq))
    }

    const view = buildEventConsequenceJournal(events)

    expect(view.entries).toHaveLength(CAP)
    // Newest retained; oldest 5 dropped.
    expect(view.entries[0]!.id).toBe(`evt-${5 + 1}`)
    expect(view.entries[CAP - 1]!.id).toBe(`evt-${CAP + 5}`)
  })

  it('caps against qualifying entries only (skipped events do not consume the cap)', () => {
    const events: WorldEvent[] = []
    let seq = 1
    // Interleave skipped events; only qualifying ones count toward the cap.
    for (let i = 0; i < CAP + 3; i += 1) {
      events.push(sessionStarted(seq)); seq += 1
      events.push(movedToRoom(seq)); seq += 1
    }

    const view = buildEventConsequenceJournal(events)
    expect(view.entries).toHaveLength(CAP)
    expect(view.entries.every((entry) => entry.text === 'You pressed on to a new area.')).toBe(true)
  })

  it('uses stable, unique evt-${seq} ids', () => {
    const view = buildEventConsequenceJournal([movedToRoom(7), itemAdded(42)])
    expect(ids(view)).toEqual(['evt-7', 'evt-42'])
    expect(new Set(ids(view)).size).toBe(view.entries.length)
  })
})

describe('buildEventConsequenceJournal - purity and determinism', () => {
  it('does not mutate the input events array or its elements', () => {
    const events = [
      movedToRoom(1),
      itemAdded(2),
      healthChanged(3, -2),
      roomStateChanged(4, { 'interaction:x': true }),
    ]
    const before = structuredClone(events)

    buildEventConsequenceJournal(events)

    expect(events).toEqual(before)
  })

  it('returns fresh output and is deterministic for identical input', () => {
    const events = [movedToRoom(1), statusChanged(2, 'add')]

    const first = buildEventConsequenceJournal(events)
    const second = buildEventConsequenceJournal(events)

    expect(first.entries).not.toBe(second.entries)
    expect(first).toEqual(second)
  })
})

describe('buildEventConsequenceJournal - leak guards', () => {
  it('never echoes content-bearing payload fields across every event type', () => {
    const view = buildEventConsequenceJournal([
      sessionStarted(1),
      movedToRoom(2),
      itemAdded(3),
      itemDiscovered(4),
      itemRemoved(5, 9),
      healthChanged(6, -3),
      healthChanged(7, 4),
      statusChanged(8, 'add'),
      statusChanged(9, 'clear'),
      roomStateChanged(10, { FLAG_KEY_SENTINEL_XYZ: true }),
    ])

    const text = allText(view)
    for (const sentinel of [
      'SEED_TITLE_SENTINEL_XYZ',
      'SEED_PREMISE_SENTINEL_XYZ',
      'SEED_TONE_SENTINEL_XYZ',
      'FROM_ROOM_ID_SENTINEL_XYZ',
      'TO_ROOM_ID_SENTINEL_XYZ',
      'ITEM_ID_SENTINEL_XYZ',
      'ITEM_NAME_SENTINEL_XYZ',
      'ROOM_ID_SENTINEL_XYZ',
      'HEALTH_REASON_SENTINEL_XYZ',
      'STATUS_SENTINEL_XYZ',
      'FLAG_KEY_SENTINEL_XYZ',
      'interaction:',
    ]) {
      expect(text).not.toContain(sentinel)
    }
  })

  it('does not leak event-type tokens or raw quantity/delta magnitudes', () => {
    const text = allText(
      buildEventConsequenceJournal([itemRemoved(1, 777), healthChanged(2, -888)]),
    )
    for (const token of [
      'moved-to-room',
      'item-added',
      'item-discovered',
      'item-removed',
      'health-changed',
      'status-changed',
      'room-state-changed',
      'session-started',
      '777',
      '888',
    ]) {
      expect(text).not.toContain(token)
    }
  })
})

describe('buildEventConsequenceJournal - structural safety', () => {
  it('exports only the runtime projectors and merger', () => {
    expect(Object.keys(eventConsequenceJournalModule)).toEqual([
      'buildEventConsequenceJournal',
      'buildMeaningfulObjectConsequenceJournal',
      'mergeMeaningfulObjectConsequenceJournal',
    ])
  })
})

function meaningfulApplied(
  seq: number,
  applied: { clueId?: string; objective?: { questId: string; objectiveId: string; toStage: 1 } },
): WorldEvent {
  return {
    ...envelope(seq),
    type: 'meaningful-object-applied',
    payload: {
      roomId: 'ROOM_ID_SENTINEL_XYZ',
      objectId: 'OBJECT_ID_SENTINEL_XYZ',
      family: 'remains',
      action: 'search',
      state: 'looted',
      ...applied,
    },
  }
}

describe('meaningful object consequence journal', () => {
  it('projects applied clue then objective in sequence order with collision-safe ids', () => {
    const view = buildMeaningfulObjectConsequenceJournal([
      meaningfulApplied(2, {
        clueId: 'CLUE_ID_SENTINEL_XYZ',
        objective: { questId: 'QUEST_ID_SENTINEL_XYZ', objectiveId: 'OBJECTIVE_ID_SENTINEL_XYZ', toStage: 1 },
      }),
    ])
    expect(view.entries).toEqual([
      { id: 'meaningful-2-clue', text: 'You discovered a clue.' },
      { id: 'meaningful-2-objective', text: 'You advanced an objective.' },
    ])
    expect(JSON.stringify(view)).not.toContain('SENTINEL')
  })

  it('emits nothing for object/item state alone and dedupes clue/objective identities', () => {
    const objective = { questId: 'quest', objectiveId: 'objective', toStage: 1 as const }
    const view = buildMeaningfulObjectConsequenceJournal([
      meaningfulApplied(1, {}),
      meaningfulApplied(2, { clueId: 'clue', objective }),
      meaningfulApplied(3, { clueId: 'clue', objective }),
    ])
    expect(view.entries).toHaveLength(2)
    expect(view.entries.map((entry) => entry.id)).toEqual([
      'meaningful-2-clue',
      'meaningful-2-objective',
    ])
  })

  it('merges without duplicate meaningful entries and keeps the display bounded', () => {
    const meaningful = buildMeaningfulObjectConsequenceJournal([
      meaningfulApplied(20, { clueId: 'clue' }),
    ])
    const merged = mergeMeaningfulObjectConsequenceJournal({
      journalId: 'base',
      title: 'Consequences',
      entries: [
        { id: 'base-entry', text: 'Base.' },
        { id: 'meaningful-1-clue', text: 'Old projection.' },
      ],
    }, meaningful)
    expect(merged?.entries).toEqual([
      { id: 'base-entry', text: 'Base.' },
      { id: 'meaningful-20-clue', text: 'You discovered a clue.' },
    ])
  })
})
